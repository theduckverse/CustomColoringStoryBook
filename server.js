// server.js
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const OpenAI = require("openai");

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Helpers ---
function buildPrompt({ title, mainCharacter, storyIdea, ageRange, pageCount }) {
  const safeTitle =
    title && title.trim().length > 0
      ? title.trim()
      : "Sammy the Brave Iguana";

  const mc =
    mainCharacter && mainCharacter.trim().length > 0
      ? mainCharacter.trim()
      : "an iguana named Sammy who's afraid of the dark";

  const idea =
    storyIdea && storyIdea.trim().length > 0
      ? storyIdea.trim()
      : "They learn to feel safe at night with help from gentle forest friends and cozy night lights.";

  const pages = Number(pageCount) || 8;
  const age = ageRange || "3-5";

  return `
You are a children's author and coloring-book designer.

Create a JSON object for a kids' story coloring book based on this request:

Title: ${safeTitle}
Main character: ${mc}
Story idea: ${idea}
Target age range: ${age} years
Number of story pages: ${pages}

RULES:
- Aim for calm, gentle bedtime energy.
- Use SHORT, simple sentences for young kids.
- The JSON MUST be valid and match this exact schema:

{
  "title": "string",
  "tagline": "string",
  "ageRange": "string",
  "paragraphs": [
    "paragraph 1 of the story...",
    "paragraph 2...",
    "..."
  ],
  "prompts": [
    {
      "page": 1,
      "prompt": "line-art prompt for coloring page 1"
    }
  ]
}

- paragraphs: 1–2 paragraphs per 4 pages. Keep it short and cozy.
- prompts: exactly ${pages} items (page 1 to page ${pages}).
- prompts: describe black-and-white line art with **thick outlines and no shading**, ideal for kids coloring pages.
- DO NOT include code fences, comments, or any extra text. Respond with JSON ONLY.
`;
}

// --- API: Generate book (story + prompts) ---
app.post("/api/generate-images", async (req, res) => {
  const { prompts, mainCharacter, title } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

  const maxImages = Math.min(prompts.length, 8);

  const characterLine = mainCharacter
    ? `MAIN CHARACTER: ${mainCharacter}. This character must appear clearly and be the focus of the page. Keep the character's look consistent from page to page.`
    : "";

  const titleLine = title
    ? `BOOK TITLE: "${title}".`
    : "";

  try {
    const images = [];

    for (let i = 0; i < maxImages; i++) {
      const item = prompts[i];
      const page = item.page || i + 1;
      const basePrompt = item.prompt || "";

      const fullPrompt = `
PAGE ${page} ILLUSTRATION.
${titleLine}
${characterLine}
SCENE DESCRIPTION: ${basePrompt}

STYLE:
- Black-and-white line-art coloring page for young children
- Thick outlines, no shading
- Simple, cute, kid-friendly
- No detailed shading, keep areas open for coloring
      `.trim();

      const result = await openai.images.generate({
        model: "gpt-image-1",
        prompt: fullPrompt,
        size: "1024x1024"
      });

      const imageUrl = result.data[0]?.url;
      if (!imageUrl) continue;

      images.push({ page, url: imageUrl });
    }

    if (!images.length) {
      return res.status(500).json({ error: "No images generated." });
    }

    return res.json({ images });
  } catch (err) {
    console.error("Error in /api/generate-images:", err);
    return res.status(500).json({
      error: "Image generation failed.",
      details: err.message
    });
  }
});

// --- API: Export PDF ---
// Expects { title, tagline, paragraphs[], prompts[] } in body
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { title, tagline, paragraphs, prompts } = req.body || {};

    const safeTitle = title || "Custom Story Coloring Book";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle.replace(/[^a-z0-9\-]/gi, "_")}.pdf"`
    );

    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
    });

    doc.pipe(res);

    // Cover page
    doc.fontSize(24).text(safeTitle, { align: "center" });
    if (tagline) {
      doc.moveDown();
      doc.fontSize(14).text(tagline, { align: "center" });
    }
    doc.moveDown(2);
    doc
      .fontSize(10)
      .text("Generated with Magic Story Colorbooks", { align: "center" });

    doc.addPage();

    // Story text
    doc.fontSize(18).text("Story", { underline: true });
    doc.moveDown();

    doc.fontSize(12);
    (paragraphs || []).forEach((p) => {
      doc.text(p, {
        align: "left",
      });
      doc.moveDown();
    });

    // Coloring prompts
    if (prompts && prompts.length > 0) {
      doc.addPage();
      doc.fontSize(18).text("Coloring Pages (Prompts)", { underline: true });
      doc.moveDown();

      doc.fontSize(11);
      prompts.forEach((item) => {
        doc.text(`Page ${item.page}:`, {
          continued: false,
          underline: false,
          align: "left",
        });
        doc.moveDown(0.25);
        doc.fontSize(10).text(item.prompt, {
          align: "left",
          indent: 15,
        });
        doc.moveDown();
        doc.fontSize(11);
      });
    }

    doc.end();
  } catch (err) {
    console.error("Error in /api/export-pdf:", err);
    return res.status(500).json({ error: "Failed to generate PDF." });
  }
});

// --- API: Generate coloring-page images with Stability AI (Stable Diffusion) ---
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

if (!STABILITY_API_KEY) {
  console.warn("⚠️ STABILITY_API_KEY is not set. /api/generate-images will fail.");
}

app.post("/api/generate-images", async (req, res) => {
  const { prompts } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

  // Safety: don’t let someone request 100 pages at once
  const maxImages = Math.min(prompts.length, 8);

  if (!STABILITY_API_KEY) {
    return res.status(500).json({
      error: "Image generation not configured.",
      details: "Missing STABILITY_API_KEY on the server.",
    });
  }

  try {
    const images = [];

    for (let i = 0; i < maxImages; i++) {
      const item = prompts[i];
      const page = item.page || i + 1;
      const basePrompt = item.prompt || "";

      const fullPrompt = `
${basePrompt}
Black-and-white line-art coloring page for young children.
Thick outlines, no shading, simple background, kid-friendly, clean coloring-book style.
      `.trim();

      // Build multipart/form-data payload
      const form = new FormData();
      form.append("prompt", fullPrompt);
      form.append("output_format", "png");
      form.append("aspect_ratio", "1:1");
      // Optional: push it toward line-art style
      // Only works on some models, but harmless if ignored
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
        // Skip this page, continue with others
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

// --- SPA fallback (serve index.html) ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});





