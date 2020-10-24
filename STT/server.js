// Server for doing STT
// Accepts 'stream-{data,end,reset}' messages on socket.io
// Sends 'transcription_step', 'recognize_intent' or 'final_intent' messages
// 'transcription_step' payload: string with transcript
// 'recognize_intent' payload: object with text: transcript and nlu: the result of rasa/model/parse
// 			-- This response indicates that an intermediate decode found a high certainty intent
// 'final_intent' payload: object with text: transcript and nlu: the result of rasa/model/parse
// 			-- This response indicates that the stream was ended for some reason and this is the intents found with the final transcript

const http = require('http');
const socketIO = require('socket.io');
const fetch = require('node-fetch');
const {Worker} = require('worker_threads');

const STT_WORKER = './stt_worker.js';
const SERVER_PORT = 4000; // websocket server port
const NLU_SERVER = 'http://nlu:5005'; // Location of the NLU server
const INTENT_THRESHOLD = .9; // Threshold for intent classification
const INACTIVITY_TIMEOUT = 1000;
const SILENCE_TIMEOUT = 1000;
let endTimeout = null;
let silenceTimeout = null;


function processTranscript (results, transcriptCallback, intentCallback, silenceCallback) {
	transcriptCallback(results.text);

	// This is leading to multiple triggers since it doesn't dump the stream before a new trasncript comes in
	addNLUIntents(results).then(intentsFilter(intentCallback)).catch( (err) => console.log(err) );

	// Set silence timeout in case transcript doesn't change
	clearTimeout(silenceTimeout);
	silenceTimeout = setTimeout(function() {
			console.log('silenceTimeout');
			silenceCallback();
		}, SILENCE_TIMEOUT);
}

// Checks whether a transcript has an identifiable intent (above threshold)
// If it does, trigger a callback
function intentsFilter (intentCallback) {
	return function (results) {
		console.log(results.nlu.intent.name +': '+ results.nlu.intent.confidence);

		// If the transcript so far has a clear intent, transmit it
		if (results.nlu.intent.confidence > INTENT_THRESHOLD) {
			intentCallback(results);
			console.log("Found intent: " + results.nlu.intent.name);
			console.log("Utterance:", results.text)
		}
	};
};

// Get an intent evaluation from the NLU server
async function addNLUIntents(results) {
	const nlu_body = { text: results.text };

	const nlu_response = await fetch(NLU_SERVER+'/model/parse', {
		method: 'post', body: JSON.stringify(nlu_body),
		headers: {'Content-Type': 'application/json'}
	});

	results.nlu = await nlu_response.json();
	return results;
};

/////
// Set up STT worker
/////

let modelWorker = new Worker(STT_WORKER);

modelWorker.on('error', (e) => console.log(e));

resetWorker = function () {
	modelWorker.postMessage({command:'reset'});
	clearTimeout(endTimeout);
	clearTimeout(silenceTimeout);
}


/////
// HTTP server
/////

const app = http.createServer(function (req, res) {
	res.writeHead(200);
	res.write('web-microphone-websocket');
	res.end();
});

const io = socketIO(app, {});
io.set('origins', '*:*');

io.on('connection', function(socket) {
	console.log('client connected');

	modelWorker.removeAllListeners('message');
	modelWorker.on('message', function (e) {
		//console.log("Message:",e);
		if (e) switch (e.type) {
			case 'final':
				addNLUIntents(e).then((res) => socket.emit('final_intent', res ) ).catch((err) => {console.log(err);} );
				break;
			case 'intermediate':
				processTranscript (
					e,
					(transcript) => {socket.emit('transcription_step', transcript); }, // Transcript callback
					(results) => {modelWorker.postMessage({command:'dump'}); socket.emit('recognize_intent',results);}, // Intent callback
					resetWorker // Silence callback
				);
				break;
		} else {console.log("Empty message");}
	});

	// socketIO messages
	socket.once('disconnect', () => {
		console.log('client disconnected');
		clearTimeout(endTimeout);
		clearTimeout(silenceTimeout);
		// Unbind the worker from the socket
		modelWorker.removeAllListeners('message');
		modelWorker.on('message', (e) => {console.log("Discarded message");});
	});

	socket.on('stream-data', function(chunk) {
		//console.log('tick');	// Process a chunck of audio data
		modelWorker.postMessage({command:'process', chunk} );

		// timeout after 1s of inactivity
		clearTimeout(endTimeout);
		endTimeout = setTimeout(function() {
			console.log('timeout');
			resetWorker();
		},INACTIVITY_TIMEOUT);
	});

	socket.on('stream-end', function() {
		console.log('[end]');
		resetWorker();
	});

	socket.on('stream-reset', function() {
		console.log('[reset]');
		resetWorker();
	});
});

// Start the server
app.listen(SERVER_PORT, () => {
	console.log('Socket server listening on:', SERVER_PORT);
});

module.exports = app;

// I never get rid of the worker...
// modelWorker.terminate(); // Kill the worker thread (should I be cleaning up the allocated model properly?)
