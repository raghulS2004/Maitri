import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import express from "express";
import cors from "cors";
import voice from "elevenlabs-node";
import { promises as fsp } from "fs";

// Ensure audios folder exists before writing files
const audiosDir = "./audios";
if (!fs.existsSync(audiosDir)) {
  fs.mkdirSync(audiosDir);
}

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "21m00Tcm4TlvDq8ikWAM"; // Default ElevenLabs voice ID

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

// Correct Gemini model endpoint
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

const callGemini = async (history, retries = 3) => {
  const systemInstruction = history.find(m => m.role === "system");
  const userMessage = history.find(m => m.role === "user");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempting Gemini API call (${attempt}/${retries})...`);
      const resp = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: userMessage.parts[0].text }]
          }],
          systemInstruction: {
            role: "system",
            parts: [{ text: systemInstruction.parts[0].text }]
          },
          generationConfig: {
            temperature: 0.6,
            candidateCount: 1,
            topP: 0.95,
            topK: 40,
            responseMimeType: "application/json",
          }
        })
      });
      const j = await resp.json();
      if (j.error) {
        if (j.error.code === 503 && attempt < retries) {
          console.log(`Gemini overloaded, retrying in ${attempt}s...`);
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
        throw new Error(j.error.message);
      }
      const msg = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!msg) throw new Error("No valid response from Gemini API.");
      return msg;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) throw new Error("No valid response from Gemini API after multiple retries.");
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
};

async function textToSpeechBase64(text, idx) {
  const filename = `${audiosDir}/message_${idx}.mp3`;
  try {
    console.log(`Generating audio for message ${idx}: "${text}"`);
    await voice.textToSpeech(elevenLabsApiKey, voiceID, filename, text);
    if (!fs.existsSync(filename)) throw new Error(`File not created: ${filename}`);
    console.log(`Audio saved: ${filename}`);
  } catch (error) {
    console.error(`Audio generation error: ${error.message}`);
    throw error;
  }
  const data = await fsp.readFile(filename);
  return data.toString("base64");
}

// Route to list available voices
app.get("/voices", async (req, res) => {
  try {
    const voices = await voice.getVoices(elevenLabsApiKey);
    res.json(voices);
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).json({ error: "Failed to fetch voices" });
  }
});

// Test route without Gemini
app.post("/test-audio", async (req, res) => {
  const messages = [{
    text: "Hello! This is a test of the audio system working perfectly!",
    facialExpression: "smile",
    animation: "Talking_1"
  }];
  try {
    for (let i = 0; i < messages.length; i++) {
      messages[i].audio = await textToSpeechBase64(messages[i].text, i);
    }
    return res.send({ messages });
  } catch (error) {
    console.error("Test audio generation failed:", error);
    return res.status(500).send({ error: error.message });
  }
});

// Main chat endpoint
app.post("/chat", async (req, res) => {
  const user = req.body.message;
  if (!user) {
    return res.send({
      messages: [{
        text: "Hello there! How can I help you today?",
        facialExpression: "smile",
        animation: "Talking_1"
      }]
    });
  }
  if (!GEMINI_API_KEY || !elevenLabsApiKey) {
    return res.send({
      messages: [{
        text: "Please add your Gemini and ElevenLabs API keys!",
        facialExpression: "angry",
        animation: "Angry"
      }]
    });
  }
  const history = [
    {
      role: "system",
      parts: [{
        text: `You are a virtual assistant. Respond with a JSON array (max 3). Each object must have "text", "facialExpression", "animation".`
      }]
    },
    { role: "user", parts: [{ text: user }] }
  ];
  try {
    const content = await callGemini(history);
    const messages = JSON.parse(content);
    if (!Array.isArray(messages)) throw new Error("AI returned non-array JSON");
    for (let i = 0; i < messages.length; i++) {
      messages[i].audio = await textToSpeechBase64(messages[i].text, i);
    }
    return res.send({ messages });
  } catch (e) {
    console.error("Error in /chat:", e.message);
    const fallback = [{
      text: "I'm having technical difficulties. Please try again later... bye bye",
      facialExpression: "sad",
      animation: "Crying"
    }];
    try {
      fallback[0].audio = await textToSpeechBase64(fallback[0].text, 0);
    } catch {}
    return res.status(500).send({ messages: fallback });
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
  console.log(`Voices: http://localhost:${port}/voices`);
  console.log(`Test audio: http://localhost:${port}/test-audio`);
  console.log(`Chat: http://localhost:${port}/chat`);
});
