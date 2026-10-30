from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv
from pathlib import Path

from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents import create_agent

import assemblyai as aai
import os
import requests
import json
import tempfile


# ==========================================
# LOAD API KEYS
# ==========================================

load_dotenv(Path(__file__).with_name(".env"))

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY missing in backend/.env")

if not MURF_API_KEY:
    raise ValueError("MURF_API_KEY missing in backend/.env")

if not ASSEMBLYAI_API_KEY:
    raise ValueError("ASSEMBLYAI_API_KEY missing in backend/.env")

aai.settings.api_key = ASSEMBLYAI_API_KEY


# ==========================================
# FLASK
# ==========================================

app = Flask(__name__)

CORS(
    app,
    expose_headers=[
        "X-Question-Number",
        "X-Interview-Complete"
    ]
)


# ==========================================
# GEMINI MODEL
# ==========================================

print("Initializing Gemini AI...")

model = init_chat_model(
    "google_genai:gemini-2.5-flash",
    api_key=GOOGLE_API_KEY
)

print("Gemini initialized successfully!")


# ==========================================
# INTERVIEW VARIABLES
# ==========================================

agent = None
checkpointer = None

question_count = 0
current_subject = "Python"

thread_id = "amitha_interview"


# ==========================================
# PROMPTS
# ==========================================

INTERVIEW_PROMPT = """
You are Amitha, a friendly and professional AI interviewer.

You are conducting a {subject} interview.

RULES:
1. Conduct exactly 5 questions.
2. Ask one question at a time.
3. Keep questions short and conversational.
4. Acknowledge the candidate's actual answers.
5. Never invent candidate answers.
6. Adapt the next question to the candidate's response.
7. Be encouraging and professional.
8. Introduce yourself as Amitha.
"""


FEEDBACK_PROMPT = """
Review the complete interview conversation.

Return ONLY valid JSON in this exact structure:

{
    "subject": "SUBJECT",
    "candidate_score": 4,
    "feedback": "Specific strengths based on actual answers.",
    "areas_of_improvement": "Specific suggestions for improvement."
}

candidate_score must be an integer between 1 and 5.

Address the candidate directly using you and your.

Do not invent answers or achievements.
Do not include markdown or code fences.
"""


# ==========================================
# CREATE AGENT
# ==========================================

def create_interview_agent():

    global checkpointer, agent

    checkpointer = InMemorySaver()

    agent = create_agent(
        model=model,
        tools=[],
        checkpointer=checkpointer
    )


# ==========================================
# MURF AUDIO STREAMING
# ==========================================

def stream_audio(text):

    url = "https://global.api.murf.ai/v1/speech/stream"

    payload = {
        "text": text,
        "voiceId": "en-US-natalie",
        "model": "FALCON",
        "locale": "en-US",
        "sampleRate": 24000,
        "format": "MP3"
    }

    headers = {
        "Content-Type": "application/json",
        "api-key": MURF_API_KEY
    }

    try:

        response = requests.post(
            url,
            headers=headers,
            json=payload,
            stream=True,
            timeout=(15, 120)
        )

        response.raise_for_status()

        for chunk in response.iter_content(chunk_size=4096):

            if chunk:
                import base64

                yield base64.b64encode(chunk).decode("utf-8") + "\n"

    except requests.RequestException as error:

        print("Murf API Error:", error)
        raise


# ==========================================
# SPEECH TO TEXT
# ==========================================

def speech_to_text(audio_path):

    transcriber = aai.Transcriber()

    config = aai.TranscriptionConfig(
        speech_models=["universal-3-pro", "universal-2"],
        language_detection=True
    )

    transcript = transcriber.transcribe(
        audio_path,
        config=config
    )

    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(transcript.error)

    return transcript.text or ""


# ==========================================
# HOME
# ==========================================

@app.route("/", methods=["GET"])
def home():

    return jsonify({
        "success": True,
        "message": "Amitha AI Interview Assistant is running!",
        "interviewer": "Amitha"
    })


# ==========================================
# START INTERVIEW
# ==========================================

@app.route("/start-interview", methods=["POST"])
def start_interview():

    global question_count, current_subject

    try:

        data = request.get_json(silent=True) or {}

        current_subject = data.get("subject", "Python")

        question_count = 1

        create_interview_agent()

        config = {
            "configurable": {
                "thread_id": thread_id
            }
        }

        formatted_prompt = INTERVIEW_PROMPT.format(
            subject=current_subject
        )

        response = agent.invoke(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": formatted_prompt
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Introduce yourself as Amitha and ask "
                            f"the first {current_subject} interview question."
                        )
                    }
                ]
            },
            config=config
        )

        question = response["messages"][-1].content

        print(f"\nQuestion 1: {question}")

        return Response(
            stream_audio(question),
            content_type="text/plain"
        )

    except Exception as error:

        print("START ERROR:", error)

        return jsonify({
            "success": False,
            "error": str(error)
        }), 500


# ==========================================
# SUBMIT ANSWER
# ==========================================

@app.route("/submit-answer", methods=["POST"])
def submit_answer():

    global question_count

    temp_path = None

    try:

        if "audio" not in request.files:

            return jsonify({
                "success": False,
                "error": "Audio file is missing"
            }), 400

        audio_file = request.files["audio"]

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".webm"
        ) as temp_file:

            temp_path = temp_file.name

        audio_file.save(temp_path)

        # Convert candidate audio to text
        answer = speech_to_text(temp_path)

        print(f"\nAnswer {question_count}: {answer}")

        if not answer.strip():

            return jsonify({
                "success": False,
                "error": "Could not recognize your speech. Please try again."
            }), 400

        config = {
            "configurable": {
                "thread_id": thread_id
            }
        }

        # Save candidate answer in conversation
        agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": answer
                    }
                ]
            },
            config=config
        )

        # Check whether five questions have been answered
        if question_count >= 5:

            return jsonify({
                "success": True,
                "interview_complete": True,
                "message": "Interview completed!"
            }), 200

        question_count += 1

        prompt = f"""
The candidate answered question {question_count - 1}.

Their actual answer is in the conversation history.

Now ask question {question_count} of 5.

Briefly acknowledge their real answer.
Then ask one relevant follow-up question.

Keep the response under 3 sentences.
Do not invent anything about their answer.
"""

        response = agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            },
            config=config
        )

        question = response["messages"][-1].content

        print(f"\nQuestion {question_count}: {question}")

        return Response(
            stream_audio(question),
            content_type="text/plain",
            headers={
                "X-Question-Number": str(question_count),
                "X-Interview-Complete": "false"
            }
        )

    except Exception as error:

        print("SUBMIT ERROR:", error)

        return jsonify({
            "success": False,
            "error": str(error)
        }), 500

    finally:

        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


# ==========================================
# GET FEEDBACK
# ==========================================

@app.route("/get-feedback", methods=["POST"])
def get_feedback():

    try:

        config = {
            "configurable": {
                "thread_id": thread_id
            }
        }

        prompt = FEEDBACK_PROMPT.replace(
            "SUBJECT",
            current_subject
        )

        response = agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            },
            config=config
        )

        feedback_text = response["messages"][-1].content.strip()

        # Remove markdown code fences if Gemini adds them
        if feedback_text.startswith("```"):

            feedback_text = feedback_text.replace(
                "```json", ""
            ).replace("```", "").strip()

        feedback = json.loads(feedback_text)

        print("\nFEEDBACK GENERATED:", feedback)

        return jsonify({
            "success": True,
            "feedback": feedback
        })

    except Exception as error:

        print("FEEDBACK ERROR:", error)

        return jsonify({
            "success": False,
            "error": str(error)
        }), 500


# ==========================================
# RUN SERVER
# ==========================================

if __name__ == "__main__":

    print("\n================================")
    print("AMITHA AI INTERVIEW ASSISTANT")
    print("Starting Flask Server...")
    print("================================\n")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )