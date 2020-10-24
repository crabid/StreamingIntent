const http = require('http');
const socketIO = require('socket.io');
const DeepSpeech = require('deepspeech');
const fetch = require('node-fetch');

let DEEPSPEECH_MODEL = __dirname + '/models/deepspeech-0.8.2-models'; // path to deepspeech english model directory

let SILENCE_THRESHOLD = 200; // how many milliseconds of inactivity before processing the audio

const SERVER_PORT = 4000; // websocket server port

const NLU_SERVER = 'http://nlu:5005'; // Location of the NLU server

const INTENT_THRESHOLD = .9; // Threshold for intent classification

const TRANSCRIPT_INTERVAL = 200; // Time between intermediateDecode's in ms


function createModel(modelDir) {
	let modelPath = modelDir + '.pbmm';
	let scorerPath = modelDir + '.scorer';
	let model = new DeepSpeech.Model(modelPath);
	model.enableExternalScorer(scorerPath);
	return model;
}

let englishModel = createModel(DEEPSPEECH_MODEL);

let modelStream;
let recordedAudioLength = 0;
let endTimeout = null;
let silenceBuffers = [];

let currentTranscript = '';
let silenceTimeout = null;
const silenceTimeoutTolerence = 1000; // How long to wait before starting new sentence (in ms)

let numberOfBuffers = 0;
let numberOfSame = 0;
/////
// Stream handling functions
/////

function processAudioStream(data) {
	// Process a chunck of audio data
	feedAudioContent(data);

	// timeout after 1s of inactivity
	clearTimeout(endTimeout);
	endTimeout = setTimeout(function() {
		console.log('timeout');
		resetStream();
	},1000);
}

function endAudioStream(callback) {
	console.log('[end]');

	// Transmit final decoding
	let results = resetStream();
	if (results) {
		if (callback) {
			add_nlu_intents(results).then(callback).catch((err) => {console.log(err);});
		}
	}
}

function resetAudioStream(callback) {
	console.log('[reset]');

	// Transmit final decoding
	let results = resetStream();
	if (results) {
		if (callback) {
			add_nlu_intents(results).then(callback).catch((err) => {console.log(err);});
		}
	}
}

// Generate function that updates the transcript
function processTranscriptCallback(transcript_callback, intent_callback, silence_callback) {
	return function (){
		let newTranscript = intermediateDecode();
		//console.log(numberOfBuffers);
		numberOfBuffers=0;
		if (newTranscript != currentTranscript) {
			//console.log("Transcript change:",newTranscript,currentTranscript);
			//console.log("Same:",numberOfSame);
			numberOfSame=0;
			currentTranscript = newTranscript;
			transcript_callback(currentTranscript);
			intents_handler({text:currentTranscript},intent_callback);

			// Set silence timeout in case transcript doesn't change
			clearTimeout(silenceTimeout);
			silenceTimeout = setTimeout(function() {
				console.log('silenceTimeout');
				resetAudioStream(silence_callback);
			},silenceTimeoutTolerence);
		} else {if (newTranscript != '') {numberOfSame++;} }
	}
}

// Takes a transcript and a callback. If the transcript has an identifiable intent (above threshold), trigger callback
async function intents_handler(results, intent_callback) {
	// const results = await add_nlu_intents(transcript);
	const nlu_body = { text: results.text };

	const nlu_response = await fetch(NLU_SERVER+'/model/parse', {
		method: 'post', body: JSON.stringify(nlu_body),
		headers: {'Content-Type': 'application/json'}
	});

	results.nlu = await nlu_response.json();

	//console.log(JSON.stringify(results));

	console.log(results.nlu.intent.name +': '+ results.nlu.intent.confidence);

	// If the transcript so far has a clear intent, transmit it
	if (results.nlu.intent.confidence > INTENT_THRESHOLD) {
		intent_callback(results);
		console.log("Found intent: " + results.nlu.intent.name);
		console.log("Utterance:", results.text)
		//console.log("Current transcript:",currentTranscript);
		resetStream();
	}
};

// Get an intent evaluation from the NLU server
async function add_nlu_intents(results) {
	const nlu_body = { text: results.text };

	const nlu_response = await fetch(NLU_SERVER+'/model/parse', {
		method: 'post', body: JSON.stringify(nlu_body),
		headers: {'Content-Type': 'application/json'}
	});

	results.nlu = await nlu_response.json();
	return results;
};

/////
//Functions to handle the model interface
/////

function createStream() {
	modelStream = englishModel.createStream();
	recordedAudioLength = 0;
	currentTranscript='';
}

function finishStream() {
	if (modelStream) {
		let start = new Date();
		let text = modelStream.finishStream();
		if (text) {
			//console.log('');
			//console.log('Recognized Text:', text);
			let recogTime = new Date().getTime() - start.getTime();
			return {
				text,
				recogTime,
				audioLength: Math.round(recordedAudioLength)
			};
		}
	}
	silenceBuffers = [];
	modelStream = null;
}

function intermediateDecode() {
	return modelStream.intermediateDecode();
}

// Stream should always stay created as long as client is connected. Use this to reset
function resetStream() {
	clearTimeout(endTimeout);
	clearTimeout(silenceTimeout);
	let results = finishStream();
	createStream();
	return results;
}

function feedAudioContent(chunk) {
	recordedAudioLength += (chunk.length / 2) * (1 / 16000) * 1000;
	modelStream.feedAudioContent(chunk);
	numberOfBuffers++;
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

	//intents_handler({text:"I'm great!"},(results) =>{});

	createStream();

	let transcript_checks = setInterval(processTranscriptCallback(
			(transcript) => {socket.emit('transcription_step', transcript); }, // Transcript callback
			(results) => {socket.emit('recognize_intent',results);}, // Intent callback
			(results) => {socket.emit('final_intent',results);} // Silence callback
		),TRANSCRIPT_INTERVAL);

	socket.once('disconnect', () => {
		console.log('client disconnected');
		clearInterval(transcript_checks);
		finishStream(); // Close the stream
	});

	socket.on('stream-data', function(data) {
		//console.log('tick');
		processAudioStream(data);
	});

	socket.on('stream-end', function() {
		endAudioStream( (results) => {
			socket.emit('final_intent', results);
		});
	});

	socket.on('stream-reset', function() {
		resetAudioStream( (results) => {
			socket.emit('final_intent', results);
		});
	});
});

app.listen(SERVER_PORT, () => {
	console.log('Socket server listening on:', SERVER_PORT);
});

module.exports = app;
