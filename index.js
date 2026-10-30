
// ======================================
// GLOBAL VARIABLES
// ======================================

let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let currentSubject = null;
let isSpeaking = false;
let currentAudio = null;

// ======================================
// API URLS
// ======================================

const startInterviewApiUrl = "http://127.0.0.1:5000/start-interview";
const submitAnswerApiUrl = "http://127.0.0.1:5000/submit-answer";
const getFeedbackApiUrl = "http://127.0.0.1:5000/get-feedback";

// ======================================
// DOM ELEMENTS
// ======================================

const welcomeState = document.getElementById("welcomeState");
const interviewState = document.getElementById("interviewState");
const subjectBtns = document.querySelectorAll(".subject-btn");
const subjectBadge = document.getElementById("subjectBadge");
const subjectIcon = document.getElementById("subjectIcon");
const questionNum = document.getElementById("questionNum");
const speakingBubble = document.getElementById("speakingBubble");

const startInterviewBtn = document.getElementById("startInterviewBtn");
const recordBtn = document.getElementById("recordBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const recordingStatus = document.getElementById("recordingStatus");
const submitBtn = document.getElementById("submitBtn");
const endInterviewBtn = document.getElementById("endInterviewBtn");

const feedbackSection = document.getElementById("feedbackSection");
const getFeedbackArea = document.getElementById("getFeedbackArea");
const getFeedbackBtn = document.getElementById("getFeedbackBtn");
const feedbackContent = document.getElementById("feedbackContent");
const feedbackSubject = document.getElementById("feedbackSubject");
const scoreCircle = document.getElementById("scoreCircle");
const scoreValue = document.getElementById("scoreValue");
const feedbackText = document.getElementById("feedbackText");
const improvementText = document.getElementById("improvementText");
const newInterviewBtn = document.getElementById("newInterviewBtn");

// ======================================
// SUBJECT ICONS
// ======================================

const iconMap = {
    "Self Introduction": "fas fa-user text-blue-400",
    "Generative AI": "fas fa-brain text-purple-400",
    "Python": "fab fa-python text-yellow-400",
    "English": "fas fa-language text-green-400",
    "HTML": "fab fa-html5 text-orange-400",
    "CSS": "fab fa-css3-alt text-blue-400"
};

// ======================================
// UI FUNCTIONS
// ======================================

function showInterviewPanel(subject) {
    currentSubject = subject;

    subjectBtns.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.subject === subject);
    });

    welcomeState.classList.add("hidden");
    interviewState.classList.remove("hidden");
    feedbackSection.classList.add("hidden");

    subjectBadge.textContent = subject;
    subjectIcon.className = (iconMap[subject] || "fas fa-code") + " text-2xl";

    questionNum.textContent = "1";

    speakingBubble.classList.add("hidden");
    startInterviewBtn.classList.remove("hidden");

    recordBtn.classList.add("hidden");
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
    endInterviewBtn.disabled = true;

    recordingStatus.textContent = "Click Start Interview to begin";
}

function updateQuestionNumber(number) {
    questionNum.textContent = number;
}

function enableRecording() {
    recordBtn.disabled = false;
    endInterviewBtn.disabled = false;
    recordingStatus.textContent = "Click to record";
}

function disableRecording() {
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
}

function showSpeakingBubble() {
    speakingBubble.classList.remove("hidden");
}

function hideSpeakingBubble() {
    speakingBubble.classList.add("hidden");
}

function showFeedbackSection() {
    feedbackSection.classList.remove("hidden");
    getFeedbackArea.classList.remove("hidden");
    feedbackContent.classList.add("hidden");

    endInterviewBtn.disabled = true;
    disableRecording();

    recordingStatus.textContent = "Interview ended";
    hideSpeakingBubble();
}

// ======================================
// FEEDBACK DISPLAY
// ======================================

function displayFeedback(data) {
    feedbackSubject.textContent = data.subject || currentSubject;

    scoreValue.textContent = data.candidate_score || 0;

    const score = Number(data.candidate_score) || 0;
    const offset = 301.6 - (score / 5) * 301.6;

    scoreCircle.style.strokeDashoffset = offset;

    feedbackText.textContent = data.feedback || "No feedback available";

    improvementText.textContent =
        data.areas_of_improvement || "No suggestions available";

    getFeedbackArea.classList.add("hidden");
    feedbackContent.classList.remove("hidden");
}

// ======================================
// RESET INTERVIEW
// ======================================

function resetToWelcome() {
    currentSubject = null;
    isSpeaking = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }

    mediaRecorder = null;
    recordingChunks = [];
    recordedBlob = null;

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    subjectBtns.forEach(btn => btn.classList.remove("active"));

    welcomeState.classList.remove("hidden");
    interviewState.classList.add("hidden");

    speakingBubble.classList.add("hidden");

    scoreCircle.style.strokeDashoffset = 301.6;

    getFeedbackBtn.textContent = "Get Feedback";
    getFeedbackBtn.disabled = false;
}

// ======================================
// AUDIO STREAMING
// ======================================

async function handleAudioStream(response, onComplete) {

    if (!response.ok) {
        throw new Error("Audio request failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const mediaSource = new MediaSource();
    const audioUrl = URL.createObjectURL(mediaSource);

    let sourceBuffer;
    let queue = [];
    let isSourceBufferReady = false;

    showSpeakingBubble();

    isSpeaking = true;
    recordBtn.disabled = true;

    recordingStatus.textContent = "Amitha is speaking...";

    if (currentAudio) {
        currentAudio.pause();
    }

    currentAudio = new Audio(audioUrl);

    currentAudio.play().catch(error => {
        console.error("Audio playback error:", error);
    });

    mediaSource.addEventListener("sourceopen", () => {

        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");

        isSourceBufferReady = true;

        sourceBuffer.addEventListener("updateend", () => {
            if (queue.length > 0 && !sourceBuffer.updating) {
                sourceBuffer.appendBuffer(queue.shift());
            }
        });

        if (queue.length > 0 && !sourceBuffer.updating) {
            sourceBuffer.appendBuffer(queue.shift());
        }
    });

    function processChunk({ done, value }) {

        if (done) {
            if (mediaSource.readyState === "open") {
                try {
                    mediaSource.endOfStream();
                } catch (error) {
                    console.error(error);
                }
            }
            return;
        }

        const textChunk = decoder.decode(value, { stream: true });

        textChunk.split("\n").forEach(line => {

            if (!line.trim()) return;

            try {
                const binaryString = atob(line);

                const bytes = new Uint8Array(binaryString.length);

                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                if (isSourceBufferReady && !sourceBuffer.updating) {
                    sourceBuffer.appendBuffer(bytes);
                } else {
                    queue.push(bytes);
                }

            } catch (error) {
                console.error("Audio decoding error:", error);
            }
        });

        return reader.read().then(processChunk);
    }

    currentAudio.onended = () => {
        isSpeaking = false;
        hideSpeakingBubble();
        URL.revokeObjectURL(audioUrl);

        if (onComplete) onComplete();

        if (!recordBtn.disabled) return;

        enableRecording();
    };

    currentAudio.onerror = () => {
        isSpeaking = false;
        hideSpeakingBubble();
        URL.revokeObjectURL(audioUrl);
        recordingStatus.textContent = "Audio playback error";
    };

    await reader.read().then(processChunk);
}

// ======================================
// RECORDING FUNCTIONS
// ======================================

async function startRecording() {

    try {

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        const options = {
            mimeType: "audio/webm;codecs=opus"
        };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = "audio/webm";
        }

        mediaRecorder = new MediaRecorder(stream, options);

        recordingChunks = [];

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {

            recordedBlob = new Blob(recordingChunks, {
                type: "audio/webm"
            });

            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();

        recordBtn.classList.remove("bg-zinc-800/80", "text-gray-400");

        recordBtn.classList.add(
            "bg-red-500",
            "text-white",
            "recording-active"
        );

        micIcon.classList.add("hidden");
        stopIcon.classList.remove("hidden");

        recordingStatus.textContent = "Recording...";

        submitBtn.classList.add("hidden");

        endInterviewBtn.disabled = true;

    } catch (error) {
        console.error("Microphone error:", error);
        recordingStatus.textContent = "Microphone permission denied";
    }
}

function stopRecording() {

    if (mediaRecorder && mediaRecorder.state !== "inactive") {

        mediaRecorder.stop();

        recordBtn.classList.remove(
            "bg-red-500",
            "text-white",
            "recording-active"
        );

        recordBtn.classList.add("bg-zinc-800/80", "text-gray-400");

        micIcon.classList.remove("hidden");
        stopIcon.classList.add("hidden");

        recordingStatus.textContent = "Recording complete";

        submitBtn.classList.remove("hidden");
        submitBtn.disabled = false;
    }
}

// ======================================
// START INTERVIEW API
// ======================================

async function startInterview() {

    startInterviewBtn.classList.add("hidden");
    recordBtn.classList.remove("hidden");

    recordingStatus.textContent = "Connecting...";

    try {

        const response = await fetch(startInterviewApiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                subject: currentSubject
            })
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("text/plain")) {

            handleAudioStream(response, () => {
                endInterviewBtn.disabled = false;
            });

        } else {

            const data = await response.json();

            console.log("Question:", data.question);

            enableRecording();
            endInterviewBtn.disabled = false;
        }

    } catch (error) {

        console.error("Start interview error:", error);

        recordingStatus.textContent = "Backend not connected";

        recordBtn.classList.add("hidden");
        startInterviewBtn.classList.remove("hidden");
    }
}

// ======================================
// SUBMIT ANSWER API
// ======================================

async function submitAnswer() {

    if (!recordedBlob) {
        alert("Please record your answer first.");
        return;
    }

    disableRecording();

    recordingStatus.textContent = "Submitting answer...";

    const formData = new FormData();

    formData.append("audio", recordedBlob, "answer.webm");

    try {

        const response = await fetch(submitAnswerApiUrl, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const questionNumber = response.headers.get("X-Question-Number");

        const isComplete =
            response.headers.get("X-Interview-Complete") === "true";

        if (questionNumber) {
            updateQuestionNumber(questionNumber);
        }

        recordedBlob = null;
        recordingChunks = [];

        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("text/plain")) {

            await handleAudioStream(response, () => {

                if (isComplete) {
                    showFeedbackSection();
                } else {
                    enableRecording();
                }

            });

        } else {

            const data = await response.json();

            console.log("Answer response:", data);

            if (isComplete) {
                showFeedbackSection();
            } else {
                enableRecording();
            }
        }

    } catch (error) {

        console.error("Submit answer error:", error);

        recordingStatus.textContent = "Connection error";

        enableRecording();
    }
}

// ======================================
// END INTERVIEW
// ======================================

async function endInterview() {

    if (!confirm("End interview and get feedback?")) return;

    disableRecording();

    endInterviewBtn.disabled = true;

    recordingStatus.textContent = "Ending interview...";

    await getFeedback();
}

// ======================================
// GET FEEDBACK API
// ======================================

async function getFeedback() {

    showFeedbackSection();

    getFeedbackBtn.textContent = "Generating...";
    getFeedbackBtn.disabled = true;

    try {

        const response = await fetch(getFeedbackApiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const data = await response.json();

        if (data.success) {
            displayFeedback(data.feedback);
        } else {
            throw new Error(data.error || "Feedback generation failed");
        }

    } catch (error) {

        console.error("Feedback error:", error);

        getFeedbackBtn.textContent = "Error - Retry";
        getFeedbackBtn.disabled = false;
    }
}

// ======================================
// EVENT LISTENERS
// ======================================

subjectBtns.forEach(btn => {

    btn.addEventListener("click", () => {

        if (currentSubject === btn.dataset.subject) return;

        resetToWelcome();

        showInterviewPanel(btn.dataset.subject);
    });
});

startInterviewBtn.addEventListener("click", startInterview);

recordBtn.addEventListener("click", () => {

    if (isSpeaking || recordBtn.disabled) return;

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        startRecording();
    } else {
        stopRecording();
    }
});

submitBtn.addEventListener("click", submitAnswer);

endInterviewBtn.addEventListener("click", endInterview);

getFeedbackBtn.addEventListener("click", getFeedback);

newInterviewBtn.addEventListener("click", resetToWelcome);
