import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import express from "express";
import cors from "cors";
import voice from "elevenlabs-node";
import { promises as fsp } from "fs";
import OpenAI from "openai";

// Ensure audios folder exists before writing files
const audiosDir = "./audios";
if (!fs.existsSync(audiosDir)) {
  fs.mkdirSync(audiosDir);
}

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const voiceID = "21m00Tcm4TlvDq8ikWAM"; // Default ElevenLabs voice ID

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

// Replace Gemini with OpenAI chat completion
const callChatGPT = async (history) => {
  const messages = history.map(m => ({
    role: m.role,
    content: m.parts[0].text
  }));

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages,
    temperature: 0.6,
    max_tokens: 1000
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("No valid response from OpenAI API.");
  }
  return text;
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

// Test route without AI
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
  if (!openaiApiKey || !elevenLabsApiKey) {
    return res.send({
      messages: [{
        text: "Please add your OpenAI and ElevenLabs API keys!",
        facialExpression: "angry",
        animation: "Angry"
      }]
    });
  }

  const history = [
    {
      role: "system",
      parts: [{
        text: `You are a virtual assistant. Respond with a valid JSON array of objects (max 3). Each object must have "text", "facialExpression", and "animation".`
      }]
    },
    { role: "user", parts: [{ text: user }] }
  ];

  try {
    const content = await callChatGPT(history);
    let messages = JSON.parse(content);
    if (!Array.isArray(messages)) {
      throw new Error("AI returned non-array JSON");
    }
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
