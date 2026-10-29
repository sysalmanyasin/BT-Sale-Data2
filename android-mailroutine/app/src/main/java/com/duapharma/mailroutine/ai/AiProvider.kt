package com.duapharma.mailroutine.ai

/** The AI services the app can talk to. Each has its own key and model so switching never loses either. */
enum class AiProvider(val label: String, val defaultModel: String, val keyHelp: String) {
    GROQ("Groq", "llama-3.3-70b-versatile", "Create a key at console.groq.com/keys (the free tier is enough for email writing)."),
    ANTHROPIC("Anthropic", "claude-sonnet-5-5", "Create a key at console.anthropic.com.");

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
