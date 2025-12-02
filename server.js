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
app.post("/api/generate-book", async (req, res) => {
  try {
    const { title, mainCharacter, storyIdea, ageRange, pageCount } =
      req.body || {};

    if (!mainCharacter && !storyIdea) {
      return res.status(400).json({
        error: "Please provide at least a mainCharacter or storyIdea.",
      });
    }

    const prompt = buildPrompt({
      title,
      mainCharacter,
      storyIdea,
      ageRange,
      pageCount,
    });

    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const raw = aiResponse.output[0].content[0].text;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("JSON parse error, returning fallback shape.", err);
      parsed = {
        title: title || "Your Custom Story",
        tagline: "",
        ageRange: ageRange || "",
        paragraphs: [raw],
        prompts: [],
      };
    }

    if (!Array.isArray(parsed.paragraphs)) parsed.paragraphs = [];
    if (!Array.isArray(parsed.prompts)) parsed.prompts = [];

    return res.json(parsed);
  } catch (err) {
    console.error("Error in /api/generate-book:", err);
    return res.status(500).json({ error: "Failed to generate book." });
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

// --- API: Generate coloring-page images with OpenAI ---
app.post("/api/generate-images", async (req, res) => {
  const { prompts } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

  // safety cap so nobody asks for 100 pages at once
  const maxImages = Math.min(prompts.length, 8);

  try {
    const images = [];

    for (let i = 0; i < maxImages; i++) {
      const item = prompts[i];
      const page = item.page || i + 1;
      const basePrompt = item.prompt || "";

      const fullPrompt = `
${basePrompt}
Black and white line-art coloring page for young children.
Thick outlines, no shading, simple background, kid-friendly.
      `.trim();

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: fullPrompt,
        n: 1,
        size: "1024x1024"
        // ❌ no response_format here – your API version doesn't support it
      });

      console.log(
        "Image API raw response for page",
        page,
        JSON.stringify(response, null, 2)
      );

      const url = response.data?.[0]?.url;
      if (!url) {
        console.error("No URL returned for page", page);
        continue;
      }

      images.push({ page, url });
    }

    return res.json({ images });
  } catch (err) {
    console.error(
      "Error generating images:",
      err?.response?.data || err?.message || err
    );
    return res.status(500).json({
      error: "Image generation failed",
      details: err?.response?.data || err?.message || String(err),
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



