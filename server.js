// server.js - Complete Server Setup

// 1. Core Imports
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // Required for fetch in older Node environments
const FormData = require('form-data'); // Required for multipart/form-data requests
// Note: In modern Node.js versions (v18+), global fetch and FormData may be available.
// If using older Node, ensure you 'npm install node-fetch form-data'

const app = express();
const PORT = 3000; // Choose your desired port

// 2. Middleware
// Use body-parser to handle incoming JSON data
app.use(bodyParser.json());
// Serve static files (like your index.html, Scribbles.jpg, etc.)
app.use(express.static('public'));

// 3. Environment Variables (Stability AI Key)
// Use process.env to load secrets from a .env file (if using dotenv) or environment
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

if (!STABILITY_API_KEY) {
    console.warn("⚠️ STABILITY_API_KEY is not set. /api/generate-images will fail.");
}

// =================================================================
// 4. API Routes
// =================================================================

// --- API: Generate Book (Placeholder) ---
// This endpoint is crucial for the frontend and should call a Large Language Model (LLM)
// to generate the story, paragraphs, and picture prompts.
app.post("/api/generate-book", async (req, res) => {
    // You would integrate your LLM call (e.g., Gemini, OpenAI, etc.) here.
    const { title, mainCharacter, storyIdea, ageRange, pageCount } = req.body;

    if (!mainCharacter || !storyIdea) {
        return res.status(400).json({ error: "Missing required character or story idea." });
    }

    // --- MOCK RESPONSE for testing if the LLM is not set up ---
    // This structured data is what the frontend expects.
    const mockTitle = title || "Sammy's Brave Night";
    const mockTagline = `A story for ages ${ageRange} about bravery.`;
    const mockParagraphs = [
        "Sammy the little iguana loved sunshine, but when the sun went down, his cozy bedroom felt too big and dark. He hid under his green blanket.",
        "One night, a little glowing firefly, Flicker, landed on his windowsill. 'The dark isn't scary, Sammy,' whispered Flicker. 'It’s just quiet.'",
        "Sammy poked his nose out. Flicker flew toward the jungle, showing Sammy a path of light. Sammy took a deep breath and followed.",
        "They found a friendly sleeping frog on a lily pad and a shy owl peeking from a tree. All the forest friends were calm and happy in the moonlight.",
        "When Sammy returned home, he realized the dark was full of soft sounds and gentle lights, not monsters. He went to sleep, brave and peaceful."
    ];
    const mockPrompts = [
        { page: 1, prompt: "A small, shy iguana named Sammy hiding under a large green blanket in a dark bedroom." },
        { page: 2, prompt: "A tiny, bright firefly landing on a windowsill next to the blanket fort." },
        { page: 3, prompt: "Sammy the iguana slowly following the firefly into a jungle path at night." },
        { page: 4, prompt: "Sammy and the firefly looking at a sleeping frog on a giant lily pad." },
        { page: 5, prompt: "Sammy back in his bed, happy and brave, with the moonlight shining through the window." },
    ].slice(0, parseInt(pageCount)); // Limit pages based on front-end selection

    // Success response
    return res.json({
        title: mockTitle,
        tagline: mockTagline,
        ageRange: ageRange,
        paragraphs: mockParagraphs,
        prompts: mockPrompts,
        // The actual LLM-generated story would go here
    });

    // To simulate a failure for frontend testing:
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
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="custom-story.pdf"');
    // Return a dummy buffer/data to make the frontend download link work
    res.send(Buffer.from(mockPdfContent, 'utf-8'));
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
        basePrompt =
          rawItem.prompt ||
          rawItem.description ||
          "";
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

