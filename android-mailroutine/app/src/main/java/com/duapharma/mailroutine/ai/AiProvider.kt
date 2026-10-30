package com.duapharma.mailroutine.ai

/** A model offered in the Settings picker. [note] is a short hint shown under the id. */
data class AiModel(val id: String, val note: String)

/** The AI services the app can talk to. Each has its own key and model so switching never loses either. */
enum class AiProvider(
    val label: String,
    val defaultModel: String,
    val keyHelp: String,
    /** Models offered in Settings. Any other id can still be typed in. */
    val models: List<AiModel>,
    /** Ids the provider has shut down; a saved one is replaced by [defaultModel] instead of failing with 404. */
    val retiredModels: Set<String> = emptySet(),
) {
    // Text-generation models active on Groq (console.groq.com/docs/models). Speech, TTS and guard/classifier models are left out.
    GROQ(
        "Groq", "openai/gpt-oss-120b",
        "Create a key at console.groq.com/keys (the free tier is enough for email writing).",
        listOf(
            AiModel("openai/gpt-oss-120b", "Best quality · recommended"),
            AiModel("openai/gpt-oss-20b", "Fastest and cheapest"),
            AiModel("qwen/qwen3.8-27b", "Preview"),
            AiModel("meta-models/muse-spark-open", "Preview · Enterprise accounts only"),
            AiModel("minimaxai/minimax-m2.7", "Preview · Enterprise accounts only"),
        ),
        retiredModels = setOf("llama-3.3-70b-versatile", "llama-3.1-8b-instant"), // shut down by Groq on 2026-08-16
    ),
    ANTHROPIC(
        "Anthropic", "claude-sonnet-5-5", "Create a key at console.anthropic.com.",
        listOf(
            AiModel("claude-sonnet-5-5", "Balanced · default"),
            AiModel("claude-opus-5-5", "Most capable"),
            AiModel("claude-haiku-5-5", "Fastest"),
        ),
    );

    companion object {
        fun fromName(name: String?): AiProvider? = entries.firstOrNull { it.name == name }

        /**
         * Provider to use when none has been chosen yet. Installs from before Groq existed only ever had an
         * Anthropic key, so they stay on it until a Groq key is added; everyone else starts on Groq.
         */
        fun initial(hasGroqKey: Boolean, hasAnthropicKey: Boolean): AiProvider =
            if (hasAnthropicKey && !hasGroqKey) ANTHROPIC else GROQ
    }
}

/** One-tap writing helpers. The instruction is what the model is actually asked to do. */
enum class AiAction(val label: String, val instruction: String, val appliesToFields: Boolean = true) {
    IMPROVE("Improve", "Improve the clarity and flow. Keep the meaning, facts and any requests unchanged."),
    FIX_GRAMMAR("Fix grammar", "Correct spelling, grammar and punctuation only. Do not change the wording or tone otherwise."),
    SHORTER("Shorter", "Make it shorter and more direct. Keep every fact and request."),
    EXPAND("Expand", "Expand it with a little more detail and polite context. Do not invent facts or figures."),
    FORMAL("More formal", "Rewrite it in a formal, professional tone."),
    FRIENDLY("Friendlier", "Rewrite it in a warm, friendly but still professional tone."),
    NEW_SUBJECT("New subject", "Write a clearer subject line. Keep the body exactly as it is.", appliesToFields = false);

    companion object {
        /** Actions that make sense for the text of a single field (a subject line is not one). */
        val forFields: List<AiAction> = entries.filter { it.appliesToFields }
    }
}
