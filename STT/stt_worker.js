// Receives "process", "reset" and "dump" messages
// Sends an transcription object whenever it updates
// (text property is the transcription, type property is whether this is a final or intermediate transcription)

const {parentPort} = require('worker_threads');
const DeepSpeech = require('deepspeech-gpu');

let DEEPSPEECH_MODEL = __dirname + '/models/deepspeech-0.8.2-models'; // path to deepspeech english model directory

let numberOfBuffers = 0;
let chunkNumber = 0;
const chunkBatchSize = 5; // Deepspeech actually only does intermediate decoding every so many chunks. So the transcript is garanteed not to change in between
// My understanding is that the model does the computation when you feed it data and intermediateDecode() just polls its current result

let modelStream;
let recordedAudioLength;
let currentTranscript;

function createModel(modelDir) {
	let modelPath = modelDir + '.pbmm';
	let scorerPath = modelDir + '.scorer';
	let model = new DeepSpeech.Model(modelPath);
	model.enableExternalScorer(scorerPath);
	return model;
}

function createStream() {
	modelStream = englishModel.createStream();
	recordedAudioLength = 0;
	currentTranscript = '';
  numberOfBuffers = 0;
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
				audioLength: Math.round(recordedAudioLength),
        type: 'final'
			};
		}
	}
}

function intermediateDecode() {
	return modelStream.intermediateDecode();
}

// Stream should always stay created as long as client is connected. Use this to reset

function resetStream() {
	let results = finishStream();
	createStream();
	return results;
}

function feedAudioContent(chunk) {
	recordedAudioLength += (chunk.length / 2) * (1 / 16000) * 1000;
	modelStream.feedAudioContent(chunk);
  //numberOfBuffers++;
}


let englishModel = createModel(DEEPSPEECH_MODEL);
createStream();
console.log("Created stream");

parentPort.on('message', function (e) {
  switch (e.command) {
    case "process":
      // console.log("Got chunk");
      feedAudioContent(e.chunk);
      // console.log("Processed chunk");
			if ((chunkNumber++ % chunkBatchSize) == 0){
      	let newTranscript = intermediateDecode();
      	if (newTranscript != currentTranscript) {
        	//console.log("Transcript change");
        	currentTranscript = newTranscript;
        	parentPort.postMessage({type: 'intermediate', text: currentTranscript});
        	//console.log("Number of buffers:", numberOfBuffers);
        	//numberOfBuffers = 0;
      	}
			}
    break;
    case "reset":
      parentPort.postMessage(resetStream());
    break;
    case "dump":
      resetStream()
    break;
  }
});
