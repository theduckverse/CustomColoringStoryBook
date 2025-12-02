// server.js - Final version

// 1. Core imports
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // v2.x, CJS
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 3000;

// 2. Middleware
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.static("public")); // serves index.html, Scribbles.jpg, etc.

// 3. Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️ OPENAI_API_KEY is not set. /api/generate-book will fall back to a simple template."
  );
}
if (!STABILITY_API_KEY) {
  console.warn(
    "⚠️ STABILITY_API_KEY is not set. /api/generate-images will fail."
  );
}

// ---------------------------------------------------------------------
// Helper: fallback story generator (no OpenAI)
// ---------------------------------------------------------------------
function buildTemplateBook({ title, mainCharacter, storyIdea, ageRange, pageCount }) {
  const safeTitle =
    title && title.trim().length > 0 ? title.trim() : "A Very Special Adventure";
  const safeCharacter =
    mainCharacter && mainCharacter.trim().length > 0
      ? mainCharacter.trim()
      : "a brave little hero";
  const safeIdea =
    storyIdea && storyIdea.trim().length > 0
      ? storyIdea.trim()
      : "a small everyday problem that feels big at first";
  const safeAgeRange = ageRange || "3–5";
  const numPagesRaw = parseInt(pageCount, 10);
  const numPages =
    Number.isNaN(numPagesRaw) ? 8 : Math.max(4, Math.min(numPagesRaw, 16));

  const paragraphs = [
    `${safeCharacter} has a big imagination, but lately something has been on their mind: ${safeIdea}. Every day, it feels a little bit bigger and a little bit harder to ignore.`,
    `One day, ${safeCharacter} decides something has to change. They take a deep breath, look around, and wonder if maybe there is more help and magic waiting just outside their comfort zone.`,
    `As the adventure begins, ${safeCharacter} meets new friends and discovers small, brave steps they can take. Each step makes the problem feel just a tiny bit smaller and their heart a lot more confident.`,
    `Along the way, ${safeCharacter} learns that it's okay to feel nervous and it's okay to ask for help. The journey shows them that they are never really alone, even when things seem scary or confusing.`,
    `By the end of the adventure, ${safeCharacter} realizes that ${safeIdea.toLowerCase()} doesn’t have to be a scary thing anymore. They feel proud, calm, and ready for the next cozy adventure.`,
  ];

  const prompts = [];
  for (let i = 1; i <= numPages; i++) {
    let promptText;
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

  return {
    title: safeTitle,
    tagline,
    ageRange: safeAgeRange,
    mainCharacter: safeCharacter,
    storyIdea: safeIdea,
    paragraphs,
    prompts,
  };
}

// =====================================================================
// 4. API ROUTES
// =====================================================================

// --- API: Generate Book (OpenAI with JSON output, fallback to template) ---
app.post("/api/generate-book", async (req, res) => {
  const { title, mainCharacter, storyIdea, ageRange, pageCount } = req.body || {};

  if (!mainCharacter && !storyIdea) {
    return res
      .status(400)
      .json({ error: "Please provide a mainCharacter and/or storyIdea." });
  }

  // Use fallback template if no OpenAI key
  if (!OPENAI_API_KEY) {
    const book = buildTemplateBook({
      title,
      mainCharacter,
      storyIdea,
      ageRange,
      pageCount,
    });
    return res.json(book);
  }

  try {
    const safeTitle =
      title && title.trim().length > 0 ? title.trim() : "Magic Story Colorbook";
    const safeCharacter =
      mainCharacter && mainCharacter.trim().length > 0
        ? mainCharacter.trim()
        : "a child with a big feeling";
    const safeIdea =
      storyIdea && storyIdea.trim().length > 0
        ? storyIdea.trim()
        : "a gentle everyday problem that feels big";
    const safeAgeRange = ageRange || "3–5";
    const rawPages = parseInt(pageCount, 10);
    const numPages =
      Number.isNaN(rawPages) ? 8 : Math.max(4, Math.min(rawPages, 16));

    const openaiBody = {
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a cozy children's picture-book author. You write gentle, encouraging stories for kids ages 3–9, and you also design picture prompts for a coloring book version. Always respond with STRICT JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Write a comforting kids' story and page-by-page prompts.",
            title: safeTitle,
            mainCharacter: safeCharacter,
            storyIdea: safeIdea,
            ageRange: safeAgeRange,
            pageCount: numPages,
          }),
        },
      ],
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!response.ok) {
      console.error("OpenAI error:", await response.text());
      const fallbackBook = buildTemplateBook({
        title,
        mainCharacter,
        storyIdea,
        ageRange,
        pageCount,
      });
      return res.json(fallbackBook);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("JSON parse error from OpenAI:", err, content);
      parsed = {};
    }

    // Expecting structure:
    // {
    //   "title": "...",
    //   "tagline": "...",
    //   "ageRange": "...",
    //   "paragraphs": [...],
    //   "prompts": [{ "page": 1, "prompt": "..." }, ...]
    // }

    const book = {
      title: parsed.title || safeTitle,
      tagline:
        parsed.tagline ||
        `A cozy story for ages ${safeAgeRange} about ${safeIdea.toLowerCase()}.`,
      ageRange: parsed.ageRange || safeAgeRange,
      mainCharacter: safeCharacter,
      storyIdea: safeIdea,
      paragraphs:
        Array.isArray(parsed.paragraphs) && parsed.paragraphs.length > 0
          ? parsed.paragraphs
          : buildTemplateBook({
              title,
              mainCharacter,
              storyIdea,
              ageRange,
              pageCount,
            }).paragraphs,
      prompts:
        Array.isArray(parsed.prompts) && parsed.prompts.length > 0
          ? parsed.prompts.map((p, i) => ({
              page: p.page || i + 1,
              prompt: p.prompt || String(p),
            }))
          : buildTemplateBook({
              title,
              mainCharacter,
              storyIdea,
              ageRange,
              pageCount,
            }).prompts,
    };

    return res.json(book);
  } catch (err) {
    console.error("Error in /api/generate-book:", err);
    const fallbackBook = buildTemplateBook({
      title,
      mainCharacter,
      storyIdea,
      ageRange,
      pageCount,
    });
    return res.json(fallbackBook);
  }
});

// --- API: Export PDF (placeholder) ---
app.post("/api/export-pdf", async (req, res) => {
  const mockPdfContent = "This is a placeholder PDF file content.";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="custom-story.pdf"'
  );
  res.send(Buffer.from(mockPdfContent, "utf-8"));
});

// --- API: Generate coloring page images that match the story ---
app.post("/api/generate-images", async (req, res) => {
  const { prompts, character } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "No prompts provided." });
  }

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
      const scenePrompt = prompts[i] || "";
      const page = i + 1;

      // Strong, explicit prompt for Stability
      const fullPrompt = `
Black-and-white line-art coloring page.
Cartoon style, cute, kid-friendly, big simple shapes.
Thick clean outlines, white background, no color, no shading, no gradients.

Main character (must stay consistent on every page):
${character ||
  "A friendly storybook child. Same face or animal features, same hairstyle/fur, same clothing or markings, same approximate age/size on every page."}

This image must illustrate PAGE ${page} of the story.
Scene to draw (match this moment exactly):
${scenePrompt}

Important:
- Keep the main character clearly the same as on all other pages.
- Show the emotion and action described in the scene.
- Background details should fit a cozy kids' book, not be too busy.
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
      images.push({
        page,
        url: `data:image/png;base64,${base64}`,
      });
    }

    if (images.length === 0) {
      return res.status(500).json({
        error: "No images could be generated.",
        details: "Check server logs for Stability AI response errors.",
      });
    }

    return res.json({ images });
  } catch (err) {
    console.error("Error in /api/generate-images:", err);
    return res.status(500).json({
      error: "Failed to generate images.",
      details: err?.message || String(err),
    });
  }
});

// 5. Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("Serving static files from the 'public' directory.");
});
