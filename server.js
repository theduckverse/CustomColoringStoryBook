// server.js - Complete Server Setup

// 1. Core Imports
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // Required for fetch in older Node environments
const FormData = require("form-data"); // Required for multipart/form-data requests
// Note: In modern Node.js versions (v18+), global fetch and FormData may be available.
// If using older Node, ensure you 'npm install node-fetch form-data'

const app = express();
const PORT = 3000; // Choose your desired port

// 2. Middleware
// Use body-parser to handle incoming JSON data
app.use(bodyParser.json());
// Serve static files (like your index.html, Scribbles.jpg, etc.)
app.use(express.static("public"));

// 3. Environment Variables (Stability AI Key)
// Use process.env to load secrets from a .env file (if using dotenv) or environment
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

if (!STABILITY_API_KEY) {
  console.warn("⚠️ STABILITY_API_KEY is not set. /api/generate-images will fail.");
}

// =================================================================
// 4. API Routes
// =================================================================

// --- API: Generate Book (Template-Based Custom Story) ---
app.post("/api/generate-book", async (req, res) => {
  const { title, mainCharacter, storyIdea, ageRange, pageCount } = req.body;

  if (!mainCharacter || !storyIdea) {
    return res
      .status(400)
      .json({ error: "Missing required character or story idea." });
  }

  // Normalize / sanitize inputs
  const safeTitle =
    title && title.trim().length > 0 ? title.trim() : "A Very Special Adventure";
  const safeCharacter =
    mainCharacter && mainCharacter.trim().length > 0
      ? mainCharacter.trim()
      : "a brave little hero";
  const safeIdea = storyIdea.trim();
  const safeAgeRange = ageRange || "kids";

  const numPagesRaw = parseInt(pageCount, 10);
  const numPages =
    isNaN(numPagesRaw) ? 8 : Math.max(4, Math.min(numPagesRaw, 16));

  // --- Simple template-based paragraphs using your inputs ---
  const paragraphs = [
    `${safeCharacter} has a big imagination, but lately something has been on their mind: ${safeIdea}. Every day, it feels a little bit bigger and a little bit harder to ignore.`,
    `One day, ${safeCharacter} decides something has to change. They take a deep breath, look around, and wonder if maybe there is more help and magic waiting just outside their comfort zone.`,
    `As the adventure begins, ${safeCharacter} meets new friends and discovers small, brave steps they can take. Each step makes the problem feel just a tiny bit smaller and their heart a lot more confident.`,
    `Along the way, ${safeCharacter} learns that it's okay to feel nervous and it's okay to ask for help. The journey shows them that they are never really alone, even when things seem scary or confusing.`,
    `By the end of the adventure, ${safeCharacter} realizes that ${safeIdea.toLowerCase()} doesn’t have to be a scary thing anymore. They feel proud, calm, and ready for the next cozy adventure.`,
  ];

  // --- Build picture prompts for each page, tied to THIS story ---
  const prompts = [];
  for (let i = 1; i <= numPages; i++) {
    let promptText = "";

    if (i === 1) {
      promptText = `${safeCharacter} looking thoughtful in a cozy room, thinking about: ${safeIdea}.`;
    } else if (i === 2) {
      promptText = `${safeCharacter} taking a brave first step on their new adventure related to: ${safeIdea}.`;
    } else if (i === 3) {
      promptText = `${safeCharacter} meeting a friendly helper or guide who makes them feel safer and more confident.`;
    } else if (i === 4) {
      promptText = `${safeCharacter} practicing a small, brave action that helps them with ${safeIdea.toLowerCase()}.`;
    } else if (i === numPages) {
      promptText = `${safeCharacter} feeling proud and calm at the end of the story, showing how they have grown and found courage.`;
    } else {
      promptText = `${safeCharacter} in a gentle scene that continues their adventure about ${safeIdea.toLowerCase()}, looking curious and hopeful.`;
    }

    prompts.push({ page: i, prompt: promptText });
  }

  const tagline = `A cozy story for ages ${safeAgeRange} about ${safeIdea.toLowerCase()}.`;

  return res.json({
    title: safeTitle,
    tagline,
    ageRange: safeAgeRange,
    paragraphs,
    prompts,
  });

  // If you ever want to simulate a failure for frontend testing, you could
  // comment out the res.json above and use:
  // return res.status(500).json({ error: "LLM service failed." });
});

// --- API: Export PDF (Placeholder) ---
// This endpoint would use a PDF generation library (like pdfkit or Puppeteer)
// to compile the story text and coloring pages into a downloadable PDF file.
app.post("/api/export-pdf", async (req, res) => {
  // const bookData = req.body; // Contains story and prompts

  // You must use a library like 'pdfkit' or a serverless function that wraps Puppeteer/Headless Chrome
  // to correctly generate a PDF from the content. This cannot be done easily with just Express.

  // --- MOCK PDF response for successful download trigger ---
  const mockPdfContent = "This is a placeholder PDF file content.";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="custom-story.pdf"'
  );
  // Return a dummy buffer/data to make the frontend download link work
  res.send(Buffer.from(mockPdfContent, "utf-8"));
});

// --- API: Generate coloring-page images with Stability AI (Stable Diffusion) ---
app.post("/api/generate-images", async (req, res) => {
  const { prompts } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

  const maxImages = Math.min(prompts.length, 8); // Capped at 8 pages

  if (!STABILITY_API_KEY) {
    return res.status(500).json({
      error: "Image generation not configured.",
      details: "Missing STABILITY_API_KEY on the server.",
    });
  }

  try {
    const images = [];

    for (let i = 0; i < maxImages; i++) {
      const rawItem = prompts[i];
      let page = i + 1;
      let basePrompt = "";

      // Support either:
      // - { page, prompt } objects
      // - plain string prompts
      if (typeof rawItem === "string") {
        basePrompt = rawItem;
      } else if (rawItem && typeof rawItem === "object") {
        page = rawItem.page || page;
        basePrompt = rawItem.prompt || rawItem.description || "";
      }

      if (!basePrompt) {
        // Skip empty prompts
        continue;
      }

      const fullPrompt = `
${basePrompt}
Black-and-white line-art coloring page for young children.
Thick outlines, no shading, simple background, kid-friendly, clean coloring-book style.
      `.trim();

      const form = new FormData();
      form.append("prompt", fullPrompt);
      form.append("output_format", "png");
      form.append("aspect_ratio", "1:1");
      form.append("model", "stable-image-core");

      const response = await fetch(
        "https://api.stability.ai/v2beta/stable-image/generate/core",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${STABILITY_API_KEY}`,
            Accept: "image/*",
          },
          body: form,
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(
          `Stability image error for page ${page}:`,
          response.status,
          errText
        );
        if (response.status === 402) {
          return res.status(402).json({ error: "Billing limit reached" });
        }
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      images.push({ page, url: dataUrl });
    }

    if (images.length === 0) {
      return res.status(500).json({
        error: "No images could be generated.",
        details: "Check server logs for Stability AI response errors.",
      });
    }

    return res.json({ images });
  } catch (err) {
    console.error("Error in /api/generate-images (Stability):", err);
    return res.status(500).json({
      error: "Failed to generate images.",
      details: err?.message || String(err),
    });
  }
});

// 5. Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log("Serving static files from the 'public' directory.");
});

// NOTE: You will need to install dependencies:
// npm install express body-parser node-fetch form-data
