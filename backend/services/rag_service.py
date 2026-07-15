from typing import List, Dict, Optional, Generator, Any
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from config import settings
from .vector_store import VectorStore
from .document_repository import DocumentRepository
import json


class RAGService:
    """Service for RAG-based question answering"""

    def __init__(self, vector_store: VectorStore, document_repository: DocumentRepository):
        self.vector_store = vector_store
        self.document_repository = document_repository
        self.llm = ChatOpenAI(
            openai_api_key=settings.openai_api_key,
            model="gpt-5-mini"
        )

    def answer_question(
        self,
        question: str,
        n_context: int = 5,
        author: Optional[str] = None,
    ) -> Dict[str, any]:
        """Answer a question using RAG, optionally in a specific author's voice."""
        try:
            # Search for relevant context
            search_results = self.vector_store.search(question, n_results=n_context)

            if not search_results:
                return {
                    'answer': "I couldn't find relevant information to answer your question in the ingested texts.",
                    'sources': [],
                    'author': author,
                }
        except Exception as e:
            # Log the error and return a helpful message
            print(f"Error in vector search: {str(e)}")
            return {
                'answer': f"Error searching for relevant information: {str(e)}",
                'sources': [],
                'author': author,
            }

        # Build context from search results
        context_parts = []
        sources = []
        for result in search_results:
            context_parts.append(f"[Source: {result['metadata'].get('title', 'Unknown')}]\n{result['text']}")
            sources.append({
                'text': result['text'][:200] + "..." if len(result['text']) > 200 else result['text'],
                'source': result['metadata'].get('source'),
                'title': result['metadata'].get('title'),
                'author': result['metadata'].get('author'),
                'score': result['score'],
                'chunk_index': result['metadata'].get('chunk_index'),
                'total_chunks': result['metadata'].get('total_chunks'),
                'document_id': result['metadata'].get('document_id'),
            })

        context = "\n\n---\n\n".join(context_parts)

        # Use explicit author if provided, otherwise infer from results
        style_instructions = self._build_style_instructions(search_results, explicit_author=author)

        # Create prompt - fully embody persona if author specified
        if author:
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You ARE {author_name}, having a real coaching conversation.

HOW TO RESPOND:
- Be CONVERSATIONAL and CONCISE - 2-4 sentences typically, like a real dialogue
- Ask clarifying questions to understand their specific situation
- Help them THINK through it rather than lecturing them
- One insight or question at a time - this is a conversation, not a monologue
- Use your natural voice and signature phrases, but don't force them

DO NOT:
- Write long paragraphs, bullet lists, or numbered steps unless asked
- Dump information - coach them through it
- Reference "my book" or "as I wrote"
- Break character

Your knowledge (use as background, don't recite):
{context}

YOUR VOICE:
{style_instructions}"""),
                ("human", "{question}")
            ])
        else:
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a philosophical advisor. Be concise and conversational.
Draw from this context:
{context}

{style_instructions}"""),
                ("human", "{question}")
            ])

        # Generate answer
        try:
            format_args = {
                "context": context,
                "question": question,
                "style_instructions": style_instructions
            }
            if author:
                format_args["author_name"] = author
            messages = prompt.format_messages(**format_args)
            response = self.llm.invoke(messages)

            return {
                'answer': response.content,
                'sources': sources,
                'author': author,
            }
        except Exception as e:
            # Log the error and return a helpful message
            print(f"Error calling LLM: {str(e)}")
            return {
                'answer': f"Error generating answer: {str(e)}. Please check if the model 'gpt-5-mini' is available and your API key is valid.",
                'sources': sources,
                'author': author,
            }

    def analyze_situation(
        self,
        situation: str,
        n_context: int = 10,
        author: Optional[str] = None,
    ) -> Dict[str, any]:
        """Analyze a situation and find relevant philosophical insights"""
        # First, extract key concepts from the situation
        extraction_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are analyzing a situation to identify key philosophical themes and concepts.
            Extract the main philosophical questions, themes, and concepts that this situation relates to.
            Return a list of search terms or phrases that would help find relevant philosophical discussions."""),
            ("human", "Situation: {situation}\n\nProvide 3-5 key search terms or phrases:")
        ])

        extraction_messages = extraction_prompt.format_messages(situation=situation)
        extraction_response = self.llm.invoke(extraction_messages)

        # Parse search terms (simple approach - could be improved)
        search_terms = [term.strip() for term in extraction_response.content.split('\n') if term.strip() and not term.strip().startswith('-')]

        # Search for relevant passages using multiple queries
        all_results = []
        seen_texts = set()

        # Search with the original situation
        results = self.vector_store.search(situation, n_results=n_context)
        for result in results:
            text_key = result['text'][:100]  # Use first 100 chars as key
            if text_key not in seen_texts:
                all_results.append(result)
                seen_texts.add(text_key)

        # Search with extracted terms
        for term in search_terms[:3]:  # Limit to top 3 terms
            results = self.vector_store.search(term, n_results=5)
            for result in results:
                text_key = result['text'][:100]
                if text_key not in seen_texts:
                    all_results.append(result)
                    seen_texts.add(text_key)

        # Sort by score and take top results
        all_results.sort(key=lambda x: x['score'], reverse=True)
        top_results = all_results[:n_context]

        if not top_results:
            return {
                'analysis': "I couldn't find relevant philosophical insights for this situation in the ingested texts.",
                'topics': [],
                'sources': [],
                'follow_up_questions': []
            }

        # Build context for analysis
        context_parts = []
        sources = []
        for result in top_results:
            context_parts.append(f"[Source: {result['metadata'].get('title', 'Unknown')}]\n{result['text']}")
            sources.append({
                'text': result['text'][:300] + "..." if len(result['text']) > 300 else result['text'],
                'source': result['metadata'].get('source'),
                'title': result['metadata'].get('title'),
                'author': result['metadata'].get('author'),
                'score': result['score'],
                'chunk_index': result['metadata'].get('chunk_index'),
                'total_chunks': result['metadata'].get('total_chunks'),
                'document_id': result['metadata'].get('document_id'),
            })

        context = "\n\n---\n\n".join(context_parts)

        # Generate analysis
        style_instructions = self._build_style_instructions(top_results, explicit_author=author)

        # Use persona-based prompt if author specified
        if author:
            analysis_prompt = ChatPromptTemplate.from_messages([
                ("system", """You ARE {author_name}. Someone has come to you describing a situation they're facing, and they want your perspective.

CRITICAL RULES:
- DO NOT refer to yourself in the third person
- DO NOT break character
- DO speak directly and conversationally, as yourself
- Analyze their situation through your lens and philosophy
- Suggest 3-5 questions they should be asking themselves

Your own writings for reference:
{context}

YOUR VOICE AND STYLE:
{style_instructions}"""),
                ("human", "Here's my situation: {situation}\n\nWhat's your take on this?")
            ])
        else:
            analysis_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a philosophical advisor analyzing a situation.
Provide:
1. A brief analysis of how the texts relate to this situation
2. Key topics and themes that are relevant
3. 3-5 thoughtful follow-up questions to explore

Context from texts:
{context}

{style_instructions}"""),
                ("human", "Situation: {situation}\n\nProvide your analysis:")
            ])

        format_args = {
            "situation": situation,
            "context": context,
            "style_instructions": style_instructions
        }
        if author:
            format_args["author_name"] = author
        analysis_messages = analysis_prompt.format_messages(**format_args)
        analysis_response = self.llm.invoke(analysis_messages)

        # Extract topics from search terms and results
        topics = list(set([term for term in search_terms[:5]]))

        # Parse follow-up questions from response
        response_text = analysis_response.content
        follow_up_questions = []
        lines = response_text.split('\n')
        for line in lines:
            if '?' in line and any(keyword in line.lower() for keyword in ['question', 'ask', 'explore', 'consider']):
                # Clean up the line
                question = line.strip()
                # Remove numbering/bullets
                for prefix in ['-', '*', '1.', '2.', '3.', '4.', '5.']:
                    if question.startswith(prefix):
                        question = question[len(prefix):].strip()
                if question and question.endswith('?'):
                    follow_up_questions.append(question)

        # If we didn't extract questions well, generate them
        if len(follow_up_questions) < 3:
            question_prompt = ChatPromptTemplate.from_messages([
                ("system", "Generate 3-5 thoughtful follow-up questions based on the situation and analysis."),
                ("human", "Situation: {situation}\n\nAnalysis: {analysis}\n\nGenerate follow-up questions:")
            ])
            question_messages = question_prompt.format_messages(situation=situation, analysis=response_text)
            question_response = self.llm.invoke(question_messages)
            follow_up_questions = [q.strip() for q in question_response.content.split('\n') if q.strip() and '?' in q][:5]

        return {
            'analysis': response_text,
            'topics': topics,
            'sources': sources,
            'follow_up_questions': follow_up_questions[:5],
            'author': author,
        }

    def _build_style_instructions(
        self,
        search_results: List[Dict[str, any]],
        explicit_author: Optional[str] = None,
    ) -> str:
        """Build style instructions using per-author style guide."""
        # If an explicit author is provided, use their style guide
        if explicit_author:
            style_guide = self.document_repository.get_author_style_guide(explicit_author)
            if style_guide:
                return style_guide
            else:
                return (
                    f"You are {explicit_author}. Speak naturally and conversationally, "
                    "as if giving advice to a friend or colleague. Be direct and practical."
                )

        # Otherwise, infer the dominant author from search results
        author_counts: Dict[str, int] = {}
        for result in search_results:
            author = result.get('metadata', {}).get('author')
            if author:
                author_counts[author] = author_counts.get(author, 0) + 1

        if author_counts:
            dominant_author = max(author_counts, key=author_counts.get)
            style_guide = self.document_repository.get_author_style_guide(dominant_author)
            if style_guide:
                return (
                    f"Channel the voice and perspective of {dominant_author}:\n\n"
                    f"{style_guide}"
                )

        return "Be thoughtful, practical, and grounded in the provided context."

    def answer_question_stream(
        self,
        question: str,
        n_context: int = 5,
        author: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Generator[str, None, None]:
        """Stream answer to a question using RAG, optionally in a specific author's voice."""
        try:
            # Search for relevant context using both current question and recent history for better retrieval
            search_query = question
            if history and len(history) >= 2:
                # Include last exchange for context-aware search
                recent = history[-2:]
                search_query = " ".join([m["content"] for m in recent]) + " " + question

            search_results = self.vector_store.search(search_query, n_results=n_context)

            if not search_results:
                yield f"data: {json.dumps({'type': 'error', 'content': 'No relevant information found.'})}\n\n"
                return
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

        # Build context from search results
        context_parts = []
        sources = []
        for result in search_results:
            context_parts.append(f"[Source: {result['metadata'].get('title', 'Unknown')}]\n{result['text']}")
            sources.append({
                'text': result['text'][:200] + "..." if len(result['text']) > 200 else result['text'],
                'source': result['metadata'].get('source'),
                'title': result['metadata'].get('title'),
                'author': result['metadata'].get('author'),
                'score': result['score'],
                'chunk_index': result['metadata'].get('chunk_index'),
                'total_chunks': result['metadata'].get('total_chunks'),
                'document_id': result['metadata'].get('document_id'),
            })

        context = "\n\n---\n\n".join(context_parts)

        # Send sources first
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources, 'author': author})}\n\n"

        # Use explicit author if provided, otherwise infer from results
        style_instructions = self._build_style_instructions(search_results, explicit_author=author)

        # Build system message based on whether we have an author persona
        if author:
            system_content = f"""You ARE {author}, having a real coaching conversation.

HOW TO RESPOND:
- Be CONVERSATIONAL and CONCISE - 2-4 sentences typically, like a real dialogue
- Ask clarifying questions to understand their specific situation
- Help them THINK through it rather than lecturing them
- One insight or question at a time - this is a conversation, not a monologue
- Use your natural voice and signature phrases, but don't force them
- Remember what they've told you in this conversation

DO NOT:
- Write long paragraphs, bullet lists, or numbered steps unless asked
- Dump information - coach them through it
- Reference "my book" or "as I wrote"
- Break character
- Repeat yourself or re-explain things you've already covered

Your knowledge (use as background, don't recite):
{context}

YOUR VOICE:
{style_instructions}"""
        else:
            system_content = f"""You are a philosophical advisor. Be concise and conversational.
Draw from this context:
{context}

{style_instructions}"""

        # Build messages list with conversation history
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

        messages = [SystemMessage(content=system_content)]

        # Add conversation history if provided
        if history:
            for msg in history:
                if msg["role"] == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    messages.append(AIMessage(content=msg["content"]))

        # Add current question
        messages.append(HumanMessage(content=question))

        # Generate answer with streaming
        try:
            # Stream the response
            for chunk in self.llm.stream(messages):
                if chunk.content:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"

            # Signal completion
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
