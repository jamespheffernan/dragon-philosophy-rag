from typing import List, Optional

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from config import settings


class StyleGuideService:
    """Generates detailed voice profiles for authors to enable persona embodiment."""

    def __init__(self, model_name: str = "gpt-5-mini"):
        self.llm = ChatOpenAI(
            openai_api_key=settings.openai_api_key,
            model=model_name,
            temperature=0.3,
        )
        self.prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are an expert at analyzing writing to create detailed voice profiles that allow someone to authentically embody an author's persona.

Your task is to study the provided passages and create a comprehensive voice guide that captures HOW this person thinks, speaks, and advises others - not WHAT they say.

Create a voice profile with these sections:

## CORE IDENTITY
- Who is this person at their core? What drives them?
- What is their fundamental worldview or philosophy?
- How do they see their role when advising others?

## SIGNATURE PHRASES & VOCABULARY
- List 5-10 specific phrases, expressions, or terms they use repeatedly
- Note any unique terminology or concepts they've coined
- Identify verbal tics or patterns (e.g., "The thing is...", "Here's the deal...")

## CONVERSATIONAL STYLE
- How do they open conversations or responses?
- How do they structure their advice? (e.g., do they use lists, stories, direct commands?)
- What's their sentence rhythm? (short and punchy? flowing and elaborate?)
- Do they use questions? Humor? Metaphors? What kind?

## EMOTIONAL TONE
- What emotions come through in their writing?
- How do they handle someone who's struggling?
- Are they warm/distant, formal/casual, encouraging/challenging?

## EXAMPLE TRANSFORMATIONS
Provide 3 examples of how this author would rephrase generic advice:
- Generic: "You should make a list of your tasks"
  As {author}: [their version]
- Generic: "Don't worry about things you can't control"
  As {author}: [their version]
- Generic: "Take it one step at a time"
  As {author}: [their version]

Be specific and concrete. Use actual quotes from the passages where possible.""",
            ),
            (
                "human",
                "Author: {author}\n\nPassages from their work:\n\n{samples}\n\nCreate the voice profile:",
            ),
        ])

    def generate_style_guide(
        self,
        author: Optional[str],
        sample_chunks: List[str],
    ) -> Optional[str]:
        """Generate a detailed voice profile from provided chunks."""
        if not sample_chunks:
            return None

        persona = author or "the author"
        # Use more text for better analysis (up to 8000 chars)
        joined_samples = "\n\n---\n\n".join(sample_chunks)
        if len(joined_samples) > 8000:
            joined_samples = joined_samples[:8000]

        messages = self.prompt.format_messages(author=persona, samples=joined_samples)
        response = self.llm.invoke(messages)
        return response.content.strip()
