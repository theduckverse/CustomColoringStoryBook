// server.js
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const PDFDocument = require("pdfkit");
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

// ---------------- MIDDLEWARE ----------------
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------- HELPERS ----------------
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
  const age = ageRange || "3–5";

  return `
You are a gentle children's author and coloring-book designer.

Create a JSON object for a kids' story coloring book based on this request:

Title: ${safeTitle}
Main character: ${mc}
Story idea: ${idea}
Target age range: ${age} years
Number of story pages: ${pages}

RULES:
- Calm, cozy bedtime energy.
- SHORT, simple sentences for young kids.
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

DETAILS:
- paragraphs: 2–4 short paragraphs total (bedtime length).
- prompts: exactly ${pages} items (page 1 to page ${pages}).
- prompts: each describes black-and-white line art with thick outlines and no shading,
  ideal for children's coloring pages.
- DO NOT include code fences, comments, or extra text. Respond with JSON ONLY.
`;
}

// ---------------- API: GENERATE BOOK ----------------
app.post("/api/generate-book", async (req, res) => {
  try {
    const { title, mainCharacter, storyIdea, ageRange, pageCount } =
      req.body || {};

    if (!mainCharacter && !storyIdea) {
      return res
        .status(400)
        .json({ error: "Please provide at least a mainCharacter or storyIdea." });
    }

    const prompt = buildPrompt({
      title,
      mainCharacter,
      storyIdea,
      ageRange,
      pageCount,
    });

      const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    let rawText = completion.choices?.[0]?.message?.content || "";
    rawText = rawText.trim();

    // Strip ```json ... ``` if the model wraps it
    if (rawText.startsWith("```")) {
      const firstNewline = rawText.indexOf("\n");
      if (firstNewline !== -1) {
        rawText = rawText.slice(firstNewline + 1);
      }
      if (rawText.endsWith("```")) {
        rawText = rawText.slice(0, -3);
      }
      rawText = rawText.trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      console.error("JSON parse error from model, raw text:\n", rawText);
      // Fallback so UI still shows something
      parsed = {
        title: title || "Your Custom Story",
        tagline: "",
        ageRange: ageRange || "",
        paragraphs: [rawText],
        prompts: [],
      };
    }

    if (!Array.isArray(parsed.paragraphs)) parsed.paragraphs = [];
    if (!Array.isArray(parsed.prompts)) parsed.prompts = [];

    return res.json(parsed);
  } catch (err) {
    console.error("Error in /api/generate-book:", err.response?.data || err);
    return res.status(500).json({ error: "Failed to generate book." });
  }
});

// ---------------- API: EXPORT PDF ----------------
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

    // Cover
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

    // Story
    doc.fontSize(18).text("Story", { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    (paragraphs || []).forEach((p) => {
      doc.text(p, { align: "left" });
      doc.moveDown();
    });

    // Prompts
    if (prompts && prompts.length > 0) {
      doc.addPage();
      doc.fontSize(18).text("Coloring Pages (Prompts)", { underline: true });
      doc.moveDown();

      doc.fontSize(11);
      prompts.forEach((item) => {
        doc.text(`Page ${item.page}:`);
        doc.moveDown(0.25);
        doc.fontSize(10).text(item.prompt, { indent: 15 });
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

// ---------------- API: GENERATE IMAGES ----------------
app.post("/api/generate-images", async (req, res) => {
  const { prompts, mainCharacter, title } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

  const maxImages = Math.min(prompts.length, 8);

  const characterLine = mainCharacter
    ? `MAIN CHARACTER: ${mainCharacter}. This character must appear clearly and be the focus of the page. Keep the character's look consistent from page to page.`
    : "";

  const titleLine = title ? `BOOK TITLE: "${title}".` : "";

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
- No detailed shading, keep big open areas for coloring
      `.trim();

      const result = await openai.images.generate({
        model: "gpt-image-1",
        prompt: fullPrompt,
        size: "1024x1024",
      });

      const imageUrl = result.data?.[0]?.url;
      if (!imageUrl) continue;

      images.push({ page, url: imageUrl });
    }

    if (!images.length) {
      return res.status(500).json({ error: "No images generated." });
    }

    return res.json({ images });
  } catch (err) {
    console.error("Error in /api/generate-images:", err.response?.data || err);
    return res.status(500).json({
      error: "Image generation failed.",
      details: err.message,
    });
  }
});

// ---------------- SPA FALLBACK ----------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

