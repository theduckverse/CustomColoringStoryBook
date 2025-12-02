// --- API: Generate book (story + prompts) ---
app.post("/api/generate-book", async (req, res) => {
  try {
    const { title, mainCharacter, storyIdea, ageRange, pageCount } = req.body || {};

    if (!mainCharacter && !storyIdea) {
      return res.status(400).json({
        error: "Please provide at least a mainCharacter or storyIdea."
      });
    }

    const prompt = buildPrompt({
      title,
      mainCharacter,
      storyIdea,
      ageRange,
      pageCount
    });

    // This is the simple Responses call your SDK is happy with
    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    // Pull the raw text from the response
    const raw = aiResponse.output[0].content[0].text;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("JSON parse error in /api/generate-book. Raw text:\n", raw);
      // Fallback so the UI still shows something instead of a hard error
      parsed = {
        title: title || "Your Custom Story",
        tagline: "",
        ageRange: ageRange || "",
        paragraphs: [raw],
        prompts: []
      };
    }

    if (!Array.isArray(parsed.paragraphs)) parsed.paragraphs = [];
    if (!Array.isArray(parsed.prompts)) parsed.prompts = [];

    return res.json(parsed);
  } catch (err) {
    console.error("Error in /api/generate-book:", err.response?.data || err.message || err);
    return res.status(500).json({ error: "Failed to generate book." });
  }
});
