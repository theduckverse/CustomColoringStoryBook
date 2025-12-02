// server.js - Magic Story Colorbooks backend

// 1. Core Imports
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");       // For HTTP calls to Stability
const FormData = require("form-data");     // For multipart form-data to Stability
const OpenAI = require("openai");          // Official OpenAI SDK

// 2. OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,      // Set this in Render
});

// 3. Express setup
const app = express();
const PORT = process.env.PORT || 3000;     // Render provides PORT

// Middleware
app.use(bodyParser.json());
// Serve your frontend (index.html, Scribbles.jpg, shelf.png, etc.)
app.use(express.static("public"));

// 4. Environment variables for Stability
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

if (!STABILITY_API_KEY) {
  console.warn("⚠️ STABILITY_API_KEY is not set. /api/generate-images will fail.");
}

// =====================================================================
// 5. API ROUTES
// =====================================================================

// --- API: Generate Book (OpenAI-powered) ---
app.post("/api/generate-book", async (req, res) => {
  const { title, mainCharacter, storyIdea, ageRange, pageCount } = req.body || {};

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
  const safeAgeRange = ageRange || "3-5";

  const numPagesRaw = parseInt(pageCount, 10);
  const numPages =
    isNaN(numPagesRaw) ? 8 : Math.max(4, Math.min(numPagesRaw, 16));

  // System prompt that controls story + illustration prompts
  const systemPrompt = `
You write cozy, gentle children's storybooks that can be turned into coloring books.

Return ONLY valid JSON, no extra text, in this exact format:
{
  "title": string,
  "tagline": string,
  "ageRange": string,
  "paragraphs": string[],
  "prompts": [
    { "page": number, "prompt": string }
  ]
}

Story rules:
- Reading level: around the given age range (simple sentences, warm tone).
- 4–8 short paragraphs total (2–4 sentences each).
- The story should center on the main character and their situation.

Illustration prompt rules (VERY IMPORTANT):
- "prompts" is for an image model (Stable Diffusion style).
- Each prompt must describe a single, clear scene to draw as a black-and-white coloring page.
- Each prompt MUST:
  - Mention the main character by name.
  - Mention if they are a child (for example: "a young boy named Leo" or "a little girl named Maya").
  - Include visual details: approximate age, any important clothing or costume (like astronaut suit, pajamas, superhero cape, etc.), key props (teddy bear, rocket, bicycle, etc.), and the setting (bedroom, backyard, spaceship, forest, etc.).
  - Reflect the theme of the book (for example, if the story idea involves astronauts, stars, rockets, or space, the prompts should clearly include those).
- Prompts should be written like detailed camera directions, not like story text. Example style:
  "Draw a young boy named Theo in cozy space pajamas, standing by a window in his bedroom, looking up at a starry sky with a toy rocket in his hand."
- Use page numbers from 1 to pageCount.
`.trim();

  const userPrompt = `
Create a children's story and illustration prompts for a custom coloring book.

Title: "${safeTitle}"
Main character: "${safeCharacter}"
Story idea: "${safeIdea}"
Age range: "${safeAgeRange}"
Number of pages: ${numPages}

Make the story reassuring and hopeful. The character faces this challenge but grows braver and more confident by the end.
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",                      // You can swap to another OpenAI model if you like
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content returned from OpenAI");
    }

    let book;
    try {
      book = JSON.parse(content);
    } catch (parseErr) {
      console.error("JSON parse error from OpenAI:", parseErr, content);
      return res
        .status(500)
        .json({ error: "Failed to parse story from AI response." });
    }

    // Light safety checks / normalization
    if (!Array.isArray(book.paragraphs)) book.paragraphs = [];
    if (!Array.isArray(book.prompts)) book.prompts = [];

    // Ensure prompts are limited & have page numbers
    book.prompts = book.prompts
      .slice(0, numPages)
      .map((p, idx) => ({
        page: typeof p.page === "number" ? p.page : idx + 1,
        prompt: p.prompt || "",
      }))
      .filter((p) => p.prompt && typeof p.prompt === "string");

    // Fill in any missing metadata
    book.title = book.title || safeTitle;
    book.tagline =
      book.tagline ||
      `A cozy story for ages ${safeAgeRange} about ${safeIdea.toLowerCase()}.`;
    book.ageRange = book.ageRange || safeAgeRange;

    return res.json(book);
  } catch (err) {
    console.error("OpenAI /api/generate-book error:", err);

    // Fallback so UI still works if AI fails
    const fallbackParagraphs = [
      `${safeCharacter} has a big imagination, but lately something has been on their mind: ${safeIdea}. Every day, that feeling seems a little bit bigger and a little harder to ignore.`,
      `One day, ${safeCharacter} decides something has to change. They take a deep breath and wonder if there might be a new, braver way to move through the day.`,
      `As the adventure begins, ${safeCharacter} meets new friends and discovers small, brave steps they can take. Each tiny step makes the big feeling a little smaller.`,
      `By the end of the adventure, ${safeCharacter} realizes that the worry that once felt huge now feels lighter. They feel proud, calm, and ready for the next cozy adventure.`,
    ];

    const fallbackPrompts = [];
    for (let i = 1; i <= numPages; i++) {
      let promptText;
      if (i === 1) {
        promptText = `Draw ${safeCharacter} in a cozy room, clearly a child, thinking about ${safeIdea}, with a comforting object nearby (like a stuffed animal or favorite toy).`;
      } else if (i === numPages) {
        promptText = `Draw ${safeCharacter}, still a child, looking proud and calm at the end of the story, showing how much braver they have become, in a simple safe setting.`;
      } else {
        promptText = `Draw ${safeCharacter} on their gentle adventure, taking small brave steps and meeting kind helpers, in a simple kid-friendly scene.`;
      }
      fallbackPrompts.push({ page: i, prompt: promptText });
    }

    return res.json({
      title: safeTitle,
      tagline: `A cozy story for ages ${safeAgeRange} about ${safeIdea.toLowerCase()}.`,
      ageRange: safeAgeRange,
      paragraphs: fallbackParagraphs,
      prompts: fallbackPrompts,
    });
  }
});

// --- API: Export PDF (Placeholder) ---
app.post("/api/export-pdf", async (req, res) => {
  // TODO: Replace with real PDF generation (pdfkit / Puppeteer, etc.)
  const mockPdfContent = "This is a placeholder PDF file content.";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="custom-story.pdf"'
  );
  res.send(Buffer.from(mockPdfContent, "utf-8"));
});

// --- API: Generate coloring-page images with Stability AI ---
app.post("/api/generate-images", async (req, res) => {
  const { prompts } = req.body || {};

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
      const rawItem = prompts[i];
      let page = i + 1;
      let basePrompt = "";

      // Support either:
      //  - plain strings
      //  - { page, prompt } objects
      if (typeof rawItem === "string") {
        basePrompt = rawItem;
      } else if (rawItem && typeof rawItem === "object") {
        page = rawItem.page || page;
        basePrompt =
          rawItem.prompt ||
          rawItem.description ||
          "";
      }

      if (!basePrompt) continue;

      const fullPrompt = `
${basePrompt}

Line-art coloring page illustration for a children's storybook.
Black-and-white ONLY, white background.
Simple cartoon style, big clear shapes, thick clean outlines.
No color, no grey, no shading, no gradients, no textures, no cross-hatching.
Focus on the main character and the scene from the story, kid-friendly and easy to color.
      `.trim();

      const form = new FormData();
      form.append("prompt", fullPrompt);
      form.append(
        "negative_prompt",
        "full color, colored, realistic lighting, photo, 3d render, painting, gradients, heavy shading, grayscale fill, background color"
      );
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

// =====================================================================
// 6. Start the server
// =====================================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("Serving static files from the 'public' directory.");
});
