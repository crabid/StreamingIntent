# StreamingIntent
Classify the intent of utterances captured via audio using a streaming architecture so that VAD is unnecessary.

The architechture includes three components: a UI which captures the audio and ties everything together, a STT server that turn the audio into text and a NLU server which extracts intents from text.

The UI is based on React, the STT server on Mozilla deepspeech and the NLU server on rasa. This is inspired by (and borrows code from) the example https://github.com/mozilla/DeepSpeech-examples/tree/r0.8/web_microphone_websocket
