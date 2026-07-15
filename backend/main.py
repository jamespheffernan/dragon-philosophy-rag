from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Union
import os
import uuid
from pathlib import Path
import zipfile

from config import settings
from services import (
    DocumentProcessor,
    VectorStore,
    RAGService,
    DocumentRepository,
    StyleGuideService,
    ConversationRepository,
)

app = FastAPI(title="Dragon API", version="1.0.0")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),  # Configurable via CORS_ORIGINS env var
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
os.makedirs(settings.upload_dir, exist_ok=True)
document_processor = DocumentProcessor()
vector_store = VectorStore()
document_repository = DocumentRepository()
style_guide_service = StyleGuideService()
conversation_repository = ConversationRepository()
rag_service = RAGService(vector_store, document_repository)


@app.on_event("startup")
async def startup_validation():
    """Validate document integrity on startup"""
    try:
        # Get all documents from SQLite
        all_docs = document_repository.list_documents()

        if not all_docs:
            return

        # Get all document IDs that have stored vectors.
        all_vector_data = vector_store.get_all_metadata()
        vector_doc_ids = set()
        for metadata in all_vector_data:
            doc_id = metadata.get('document_id')
            if doc_id:
                vector_doc_ids.add(doc_id)

        # Check for missing vectors
        missing_count = 0
        for doc in all_docs:
            doc_id = doc.get('id')
            if doc_id not in vector_doc_ids:
                missing_count += 1
                title = doc.get('title') or doc.get('source', 'Unknown')
                print(f"WARNING: Document '{title}' (ID: {doc_id}) is missing vectors")

        if missing_count > 0:
            print(f"\n⚠️  WARNING: {missing_count} document(s) are missing vectors.")
            print("   Use POST /documents/reindex-all to restore them, or")
            print("   POST /documents/{document_id}/reindex for individual documents.")
            print("   Use GET /documents/validate to see details.\n")
        else:
            print(f"✓ All {len(all_docs)} documents are properly indexed.\n")
    except Exception as e:
        print(f"Warning: Could not validate documents on startup: {e}\n")


# Request/Response models
class SearchRequest(BaseModel):
    query: str
    n_results: Optional[int] = 5


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    n_context: Optional[int] = 5
    author: Optional[str] = None  # Optional: speak as this author
    history: Optional[List[ChatMessage]] = None  # Conversation history


class AnalyzeRequest(BaseModel):
    situation: str
    n_context: Optional[int] = 10
    author: Optional[str] = None  # Optional: analyze as this author


class DocumentUpdateRequest(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None

    def dict_for_update(self):
        return {k: v for k, v in self.model_dump().items() if v is not None}


class BulkAuthorUpdateRequest(BaseModel):
    document_ids: List[str]
    author: str


class CreateConversationRequest(BaseModel):
    title: str
    author: Optional[str] = None


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None


class MessageData(BaseModel):
    role: str
    content: str
    sources: Optional[List[dict]] = None
    author: Optional[str] = None


class AddMessagesRequest(BaseModel):
    messages: List[MessageData]


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "dragon"}


@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Dragon API"}


@app.post("/upload")
async def upload_document(
    files: List[UploadFile] = File(...),
    merge: bool = Query(False),
    title: Optional[str] = Query(None),
    author: Optional[str] = Query(None),
):
    """
    Upload and ingest documents.
    Supports PDF, EPUB, TXT.
    If merge=True, all files are zipped and treated as one document.
    """
    # Validate files
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Check for unsupported extensions in all files
    supported_exts = ['.pdf', '.epub', '.txt']
    valid_files = []

    for file in files:
        if not file.filename:
            continue

        file_ext = Path(file.filename).suffix.lower()
        if file.filename.lower().endswith('.epub.zip'):
            file_ext = '.epub'

        if file_ext in supported_exts:
            valid_files.append(file)

    if not valid_files:
        raise HTTPException(
            status_code=400,
            detail=f"No valid files found. Supported formats: {', '.join(supported_exts)}"
        )

    # Function to process a single file path (used for both merged and single modes)
    async def process_single_upload(file_path: str, original_filename: str, doc_title: str = None, doc_author: str = None, is_zip: bool = False):
        try:
            chunks = document_processor.process_file(file_path)
        except Exception as e:
            # Clean up and re-raise
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to process file {original_filename}: {str(e)}"
            )

        if not chunks:
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(
                status_code=400,
                detail=f"No text content extracted from {original_filename}"
            )

        chunk_count = len(chunks)
        document_id = Path(file_path).stem  # file_path is {uuid}.ext

        # Attach consistent metadata
        for chunk in chunks:
            metadata = chunk.setdefault('metadata', {})
            metadata['document_id'] = document_id
            if 'source' not in metadata:
                metadata['source'] = original_filename

            # If merged zip, source might be inner file, keep it but add batch info
            if is_zip:
                 metadata['batch_name'] = original_filename

        # Add to vector store
        num_chunks = vector_store.add_documents(chunks, document_id)

        # Determine final title/author
        first_meta = chunks[0]['metadata']
        final_title = doc_title or first_meta.get('title') or Path(original_filename).stem
        final_author = doc_author or first_meta.get('author')
        file_type = 'zip' if is_zip else Path(file_path).suffix.lower()[1:]

        # Create DB record
        stored_document = document_repository.create_document(
            document_id=document_id,
            source=original_filename,
            title=final_title,
            author=final_author,
            file_type=file_type,
            chunk_count=chunk_count,
            file_path=file_path,
        )

        # Generate style guide
        try:
            sample_chunks = [chunk['text'] for chunk in chunks[:3]]
            style_guide = style_guide_service.generate_style_guide(
                stored_document.get('author'),
                sample_chunks,
            )
            if style_guide:
                stored_document = document_repository.update_document(document_id, style_guide=style_guide)
        except Exception as e:
            print(f"Warning: failed to generate style guide for {document_id}: {e}")

        return {
            "success": True,
            "document_id": document_id,
            "chunks_added": num_chunks,
            "title": stored_document.get('title'),
            "author": stored_document.get('author'),
            "file_type": stored_document.get('file_type'),
        }

    # --- MERGE MODE ---
    if merge:
        # Create a single document ID for the batch
        document_id = str(uuid.uuid4())
        zip_filename = f"{document_id}.zip"
        zip_path = os.path.join(settings.upload_dir, zip_filename)

        try:
            # Create a zip file containing all uploaded files
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                for file in valid_files:
                    content = await file.read()
                    # Use original filename in the zip
                    zip_file.writestr(file.filename, content)

            # Process the zip file
            # Use provided title or first filename as default
            batch_title = title or valid_files[0].filename
            batch_source = f"Batch: {batch_title}"

            return await process_single_upload(
                file_path=zip_path,
                original_filename=batch_source,
                doc_title=batch_title,
                doc_author=author,
                is_zip=True
            )

        except Exception as e:
            if os.path.exists(zip_path):
                os.remove(zip_path)
            raise HTTPException(status_code=500, detail=f"Batch processing failed: {str(e)}")

    # --- SINGLE MODE (Default) ---
    else:
        results = []
        for file in valid_files:
            document_id = str(uuid.uuid4())
            file_ext = Path(file.filename).suffix.lower()
            if file.filename.lower().endswith('.epub.zip'):
                file_ext = '.epub'

            file_path = os.path.join(settings.upload_dir, f"{document_id}{file_ext}")

            try:
                # Save file
                content = await file.read()
                with open(file_path, "wb") as buffer:
                    buffer.write(content)

                # Process
                result = await process_single_upload(
                    file_path=file_path,
                    original_filename=file.filename,
                    doc_title=title if len(valid_files) == 1 else None, # Only apply title if single file
                    doc_author=author if len(valid_files) == 1 else None
                )
                results.append(result)

            except Exception as e:
                print(f"Error processing {file.filename}: {e}")
                # Don't fail the whole batch if one fails in non-merge mode?
                # Or just return error for that one.
                results.append({"error": str(e), "file": file.filename})

        # If single file request, return single object for backward compatibility if possible,
        # but standardized response is better.
        # API client expects single object for single upload.
        if len(results) == 1:
            if "error" in results[0]:
                raise HTTPException(status_code=400, detail=results[0]["error"])
            return results[0]

        return {"results": results}


@app.post("/search")
async def search(request: SearchRequest):
    """Search for relevant sections by term"""
    try:
        results = vector_store.search(request.query, n_results=request.n_results)

        formatted_results = []
        for result in results:
            formatted_results.append({
                "text": result['text'],
                "source": result['metadata'].get('source'),
                "title": result['metadata'].get('title'),
                "author": result['metadata'].get('author'),
                "score": result['score'],
                "metadata": result['metadata']
            })

        return {
            "query": request.query,
            "results": formatted_results,
            "count": len(formatted_results)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error searching: {str(e)}")


@app.post("/chat")
async def chat(request: ChatRequest):
    """Ask a question and get an answer based on the texts"""
    try:
        response = rag_service.answer_question(
            request.question,
            n_context=request.n_context,
            author=request.author,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating answer: {str(e)}")


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream answer to a question based on the texts"""
    # Convert history to list of dicts if provided
    history = None
    if request.history:
        history = [{"role": m.role, "content": m.content} for m in request.history]

    return StreamingResponse(
        rag_service.answer_question_stream(
            request.question,
            n_context=request.n_context,
            author=request.author,
            history=history,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """Analyze a situation and get relevant philosophical insights"""
    try:
        response = rag_service.analyze_situation(
            request.situation,
            n_context=request.n_context,
            author=request.author,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing situation: {str(e)}")


@app.get("/documents")
async def list_documents():
    """Get list of all ingested documents"""
    try:
        documents = document_repository.list_documents()
        authors = document_repository.list_authors()
        return {"documents": documents, "count": len(documents), "authors": authors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing documents: {str(e)}")


@app.get("/authors")
async def list_authors():
    """Get list of all unique authors with their style guides"""
    try:
        authors = document_repository.list_authors_with_details()
        return {"authors": authors, "count": len(authors)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing authors: {str(e)}")


@app.post("/authors/{author_name}/regenerate-style-guide")
async def regenerate_author_style_guide(author_name: str):
    """Regenerate the style guide for an author based on all their documents"""
    try:
        # Get all documents by this author
        docs = document_repository.get_documents_by_author(author_name)
        if not docs:
            raise HTTPException(status_code=404, detail=f"No documents found for author: {author_name}")

        # Gather sample chunks from all documents
        all_chunks = []
        for doc in docs:
            doc_id = doc.get('id')
            if doc_id:
                chunks = vector_store.get_document_chunks(doc_id)
                # Take up to 5 chunks per document
                all_chunks.extend([c['text'] for c in chunks[:5]])

        if not all_chunks:
            raise HTTPException(status_code=400, detail="No text chunks found for this author's documents")

        # Generate style guide
        style_guide = style_guide_service.generate_style_guide(author_name, all_chunks[:15])

        # Save to authors table
        author_record = document_repository.upsert_author(author_name, style_guide)

        return {
            "author": author_name,
            "style_guide": style_guide,
            "documents_sampled": len(docs),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error regenerating style guide: {str(e)}")


@app.post("/documents/bulk-update-author")
async def bulk_update_author(request: BulkAuthorUpdateRequest):
    """Update the author for multiple documents at once"""
    if not request.document_ids:
        raise HTTPException(status_code=400, detail="No document IDs provided")
    if not request.author.strip():
        raise HTTPException(status_code=400, detail="Author name is required")

    try:
        updated_count = document_repository.bulk_update_author(
            request.document_ids,
            request.author.strip(),
        )

        # Also update vector store metadata for each document
        for doc_id in request.document_ids:
            try:
                vector_store.update_metadata_for_document(doc_id, {"author": request.author.strip()})
            except Exception as e:
                print(f"Warning: failed to update vector metadata for {doc_id}: {e}")

        return {"updated_count": updated_count, "author": request.author.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating author: {str(e)}")


@app.patch("/documents/{document_id}")
async def update_document(document_id: str, payload: DocumentUpdateRequest):
    """Update document metadata such as title or author"""
    updates = payload.dict_for_update()
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    document = document_repository.update_document(
        document_id,
        title=updates.get('title'),
        author=updates.get('author'),
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Propagate changes to vector store metadata
    try:
        vector_store.update_metadata_for_document(document_id, updates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating vector metadata: {str(e)}")

    return {"document": document}


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and all its chunks"""
    try:
        deleted_rows = document_repository.delete_document(document_id)
        if deleted_rows == 0:
            raise HTTPException(status_code=404, detail="Document not found")
        num_deleted = vector_store.delete_document(document_id)
        return {"success": True, "chunks_deleted": num_deleted}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting document: {str(e)}")


@app.get("/documents/{document_id}/context")
async def get_document_context(
    document_id: str,
    chunk_index: int = Query(..., ge=0),
    window: int = Query(1, ge=0, le=5),
):
    """Return a window of text around a specific chunk for a document."""
    document = document_repository.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        chunks = vector_store.get_context_window(document_id, chunk_index, window)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching context: {str(e)}")

    return {
        "document": document,
        "chunks": chunks,
        "total_chunks": document.get('chunk_count', 0),
        "requested_chunk_index": chunk_index,
        "window": window,
    }


@app.post("/documents/{document_id}/regenerate-style-guide")
async def regenerate_style_guide(document_id: str):
    """Regenerate the stored style guide for a document."""
    document = document_repository.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    chunk_count = document.get('chunk_count') or 0
    if chunk_count == 0:
        raise HTTPException(status_code=400, detail="Document has no chunks to analyze")

    sample_indices = list(range(min(5, chunk_count)))
    chunks = vector_store.get_document_chunks(document_id, sample_indices)
    sample_texts = [chunk['text'] for chunk in chunks if chunk.get('text')]
    if not sample_texts:
        raise HTTPException(status_code=400, detail="Unable to load document chunks for analysis")

    try:
        style_guide = style_guide_service.generate_style_guide(document.get('author'), sample_texts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating style guide: {str(e)}")

    if not style_guide:
        raise HTTPException(status_code=500, detail="Failed to generate style guide")

    updated_document = document_repository.update_document(document_id, style_guide=style_guide)
    return {"style_guide": style_guide, "document": updated_document}


@app.get("/documents/validate")
async def validate_documents():
    """Validate document integrity by checking for missing vectors."""
    try:
        # Get all documents from SQLite
        all_docs = document_repository.list_documents()

        # Get all document IDs that have stored vectors.
        all_vector_data = vector_store.get_all_metadata()
        vector_doc_ids = set()
        for metadata in all_vector_data:
            doc_id = metadata.get('document_id')
            if doc_id:
                vector_doc_ids.add(doc_id)

        # Find documents missing vectors
        missing_vectors = []
        for doc in all_docs:
            doc_id = doc.get('id')
            if doc_id not in vector_doc_ids:
                missing_vectors.append({
                    "id": doc_id,
                    "title": doc.get('title'),
                    "source": doc.get('source'),
                    "file_path": doc.get('file_path'),
                    "file_exists": os.path.exists(doc.get('file_path', '')) if doc.get('file_path') else False,
                })

        return {
            "total_documents": len(all_docs),
            "documents_with_vectors": len(vector_doc_ids),
            "missing_vectors": len(missing_vectors),
            "missing_documents": missing_vectors,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating documents: {str(e)}")


@app.post("/documents/{document_id}/reindex")
async def reindex_document(document_id: str):
    """Re-index a document from its stored file"""
    try:
        # Get document from repository
        document = document_repository.get_document(document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        # Find the file
        file_path = document.get('file_path')
        if not file_path or not os.path.exists(file_path):
            # Try to find file by document_id
            upload_dir = settings.upload_dir
            possible_extensions = ['.pdf', '.epub', '.txt', '.zip']
            file_path = None

            for ext in possible_extensions:
                candidate = os.path.join(upload_dir, f"{document_id}{ext}")
                if os.path.exists(candidate):
                    file_path = candidate
                    break

            if not file_path:
                raise HTTPException(
                    status_code=404,
                    detail=f"File not found for document {document_id}. Please re-upload the file."
                )

        # Delete existing vectors for this document
        vector_store.delete_document(document_id)

        # Process the document
        try:
            chunks = document_processor.process_file(file_path)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to process file: {str(e)}"
            )

        if not chunks or len(chunks) == 0:
            raise HTTPException(
                status_code=400,
                detail="No text content could be extracted from the file"
            )

        # Add metadata to chunks
        for chunk in chunks:
            metadata = chunk.setdefault('metadata', {})
            metadata['document_id'] = document_id
            metadata['source'] = document.get('source')
            metadata['title'] = document.get('title')
            metadata['author'] = document.get('author')
            metadata['file_type'] = document.get('file_type')

        # Add to vector store
        num_chunks = vector_store.add_documents(chunks, document_id)

        # Update document with new chunk count and file path
        document_repository.update_document(
            document_id,
            chunk_count=num_chunks,
            file_path=file_path,
        )

        return {
            "success": True,
            "document_id": document_id,
            "chunks_added": num_chunks,
            "title": document.get('title'),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error re-indexing document: {str(e)}")


@app.post("/documents/reindex-all")
async def reindex_all_documents():
    """Re-index all documents that are missing vectors"""
    try:
        # Get validation results
        validation = await validate_documents()
        missing = validation.get('missing_documents', [])

        if not missing:
            return {
                "success": True,
                "message": "All documents are properly indexed",
                "reindexed": 0,
            }

        results = []
        for doc in missing:
            doc_id = doc.get('id')
            try:
                # Try to re-index
                result = await reindex_document(doc_id)
                results.append({
                    "document_id": doc_id,
                    "title": doc.get('title'),
                    "status": "success",
                    "chunks_added": result.get('chunks_added', 0),
                })
            except Exception as e:
                results.append({
                    "document_id": doc_id,
                    "title": doc.get('title'),
                    "status": "error",
                    "error": str(e),
                })

        success_count = sum(1 for r in results if r.get('status') == 'success')

        return {
            "success": True,
            "reindexed": success_count,
            "total": len(missing),
            "results": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error re-indexing documents: {str(e)}")


# ============================================================================
# CONVERSATION ENDPOINTS - Chat Persistence
# ============================================================================

@app.get("/conversations")
async def list_conversations():
    """List all conversations ordered by most recent first"""
    try:
        conversations = conversation_repository.list_conversations()
        return {"conversations": conversations, "count": len(conversations)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing conversations: {str(e)}")


@app.post("/conversations")
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation"""
    try:
        conversation_id = str(uuid.uuid4())
        conversation = conversation_repository.create_conversation(
            conversation_id=conversation_id,
            title=request.title,
            author=request.author,
        )
        return conversation
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating conversation: {str(e)}")


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get a conversation with all its messages"""
    try:
        conversation = conversation_repository.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching conversation: {str(e)}")


@app.patch("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, request: UpdateConversationRequest):
    """Update conversation metadata"""
    try:
        conversation = conversation_repository.update_conversation(
            conversation_id=conversation_id,
            title=request.title,
            author=request.author,
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating conversation: {str(e)}")


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation and all its messages"""
    try:
        deleted_rows = conversation_repository.delete_conversation(conversation_id)
        if deleted_rows == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"success": True, "deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting conversation: {str(e)}")


@app.post("/conversations/{conversation_id}/messages")
async def add_messages(conversation_id: str, request: AddMessagesRequest):
    """Add one or more messages to a conversation"""
    try:
        # Verify conversation exists
        conversation = conversation_repository.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Add messages
        added_messages = []
        for msg_data in request.messages:
            message_id = str(uuid.uuid4())
            message = conversation_repository.add_message(
                message_id=message_id,
                conversation_id=conversation_id,
                role=msg_data.role,
                content=msg_data.content,
                sources=msg_data.sources,
                author=msg_data.author,
            )
            added_messages.append(message)

        return {"messages": added_messages, "count": len(added_messages)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding messages: {str(e)}")
