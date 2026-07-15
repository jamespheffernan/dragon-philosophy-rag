import os
import zipfile
import tempfile
import shutil
from typing import List, Dict, Optional
from pathlib import Path
import pypdf
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter


class DocumentProcessor:
    """Service to handle document parsing and chunking"""

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
        )

    def _extract_epub_from_zip(self, zip_path: str, temp_dir: str) -> str:
        """Extract EPUB file from a ZIP archive. Returns path to extracted EPUB."""
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Look for EPUB files in the ZIP
            epub_files = [f for f in zip_ref.namelist() if f.lower().endswith('.epub') and not f.endswith('/')]

            if not epub_files:
                raise ValueError("No EPUB file found in the ZIP archive")

            # Extract the first EPUB file found
            epub_file = epub_files[0]
            zip_ref.extract(epub_file, temp_dir)
            extracted_path = os.path.join(temp_dir, epub_file)

            # Normalize the path (handle any path separators)
            extracted_path = os.path.normpath(extracted_path)

            if not os.path.isfile(extracted_path):
                raise ValueError(f"Extracted path is not a file: {extracted_path}")

            return extracted_path

    def _repack_epub_directory(self, zip_path: str, temp_dir: str) -> str:
        """
        Handle malformed EPUBs that are ZIPs of an EPUB directory.
        Extracts and repacks into a proper EPUB structure.
        """
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            namelist = zip_ref.namelist()

            # Check if this looks like a zipped EPUB directory
            # (files are nested under a .epub/ folder instead of at root)
            epub_dirs = [n for n in namelist if '.epub/' in n.lower()]

            if not epub_dirs:
                return None  # Not a zipped EPUB directory

            # Find the EPUB directory prefix
            first_file = epub_dirs[0]
            epub_dir_prefix = first_file.split('/')[0] + '/'

            # Extract everything
            zip_ref.extractall(temp_dir)

            # The extracted EPUB directory
            extracted_epub_dir = os.path.join(temp_dir, epub_dir_prefix.rstrip('/'))

            if not os.path.isdir(extracted_epub_dir):
                return None

            # Check if META-INF/container.xml exists in the extracted directory
            container_path = os.path.join(extracted_epub_dir, 'META-INF', 'container.xml')
            if not os.path.exists(container_path):
                # Try to find it
                for root, dirs, files in os.walk(extracted_epub_dir):
                    if 'container.xml' in files and 'META-INF' in root:
                        # Found it in a subdirectory, adjust the epub_dir
                        extracted_epub_dir = os.path.dirname(os.path.dirname(os.path.join(root, 'container.xml')))
                        break

            # Repack as a proper EPUB
            repacked_path = os.path.join(temp_dir, 'repacked.epub')
            with zipfile.ZipFile(repacked_path, 'w', zipfile.ZIP_DEFLATED) as epub_zip:
                for root, dirs, files in os.walk(extracted_epub_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, extracted_epub_dir)
                        epub_zip.write(file_path, arcname)

            return repacked_path

    def process_file(self, file_path: str) -> List[Dict[str, any]]:
        """Process a file and return chunks with metadata"""
        file_ext = Path(file_path).suffix.lower()
        temp_dir = None

        try:
            # Handle .epub.zip files
            if file_path.lower().endswith('.epub.zip'):
                temp_dir = tempfile.mkdtemp()
                file_path = self._extract_epub_from_zip(file_path, temp_dir)
                file_ext = '.epub'

            if file_ext == '.pdf':
                return self._process_pdf(file_path)
            elif file_ext == '.txt':
                return self._process_txt(file_path)
            elif file_ext == '.zip':
                return self._process_zip(file_path)
            elif file_ext == '.epub':
                # Try to process as EPUB first
                try:
                    return self._process_epub(file_path)
                except Exception as e:
                    # If it fails, check if it's a zipped EPUB directory
                    if "META-INF/container.xml" in str(e) or "container.xml" in str(e):
                        if temp_dir is None:
                            temp_dir = tempfile.mkdtemp()
                        repacked_path = self._repack_epub_directory(file_path, temp_dir)
                        if repacked_path:
                            return self._process_epub(repacked_path)
                    raise  # Re-raise if we can't fix it
            else:
                raise ValueError(f"Unsupported file format: {file_ext}")
        finally:
            # Clean up temporary extracted files
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

    def _process_pdf(self, file_path: str) -> List[Dict[str, any]]:
        """Extract text from PDF file"""
        chunks = []
        metadata = {
            'source': Path(file_path).name,
            'file_type': 'pdf',
            'author': None,
            'title': Path(file_path).stem,
        }

        try:
            with open(file_path, 'rb') as file:
                pdf_reader = pypdf.PdfReader(file)

                # Try to extract metadata
                if pdf_reader.metadata:
                    if pdf_reader.metadata.get('/Author'):
                        metadata['author'] = pdf_reader.metadata['/Author']
                    if pdf_reader.metadata.get('/Title'):
                        metadata['title'] = pdf_reader.metadata['/Title']

                # Extract text from all pages
                full_text = ""
                for page_num, page in enumerate(pdf_reader.pages, start=1):
                    page_text = page.extract_text()
                    full_text += f"\n\n[Page {page_num}]\n{page_text}"

                # Split into chunks
                text_chunks = self.text_splitter.split_text(full_text)

                for idx, chunk in enumerate(text_chunks):
                    chunks.append({
                        'text': chunk,
                        'metadata': {
                            **metadata,
                            'chunk_index': idx,
                            'total_chunks': len(text_chunks),
                        }
                    })

        except Exception as e:
            raise Exception(f"Error processing PDF: {str(e)}")

        return chunks

    def _process_epub(self, file_path: str) -> List[Dict[str, any]]:
        """Extract text from EPUB file"""
        chunks = []
        metadata = {
            'source': Path(file_path).name,
            'file_type': 'epub',
            'author': None,
            'title': Path(file_path).stem,
            'chapter': None,
        }

        try:
            book = epub.read_epub(file_path)

            # Extract metadata
            if book.get_metadata('DC', 'title'):
                metadata['title'] = book.get_metadata('DC', 'title')[0][0]
            if book.get_metadata('DC', 'creator'):
                metadata['author'] = book.get_metadata('DC', 'creator')[0][0]

            # Extract text from all chapters
            full_text = ""
            current_chapter = None

            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_DOCUMENT:
                    # Try to get chapter title from item name
                    item_name = item.get_name()
                    if 'chapter' in item_name.lower() or 'section' in item_name.lower():
                        current_chapter = item_name

                    # Extract text from HTML
                    soup = BeautifulSoup(item.get_content(), 'html.parser')
                    text = soup.get_text(separator=' ', strip=True)

                    if text:
                        if current_chapter:
                            full_text += f"\n\n[{current_chapter}]\n{text}"
                        else:
                            full_text += f"\n\n{text}"

            # Split into chunks
            text_chunks = self.text_splitter.split_text(full_text)

            for idx, chunk in enumerate(text_chunks):
                chunk_metadata = {
                    **metadata,
                    'chunk_index': idx,
                    'total_chunks': len(text_chunks),
                }
                if current_chapter:
                    chunk_metadata['chapter'] = current_chapter

                chunks.append({
                    'text': chunk,
                    'metadata': chunk_metadata
                })

        except Exception as e:
            raise Exception(f"Error processing EPUB: {str(e)}")

        return chunks

    def _process_txt(self, file_path: str) -> List[Dict[str, any]]:
        """Extract text from TXT file"""
        chunks = []
        metadata = {
            'source': Path(file_path).name,
            'file_type': 'txt',
            'author': None,
            'title': Path(file_path).stem,
        }

        try:
            try:
                with open(file_path, 'r', encoding='utf-8') as file:
                    full_text = file.read()
            except UnicodeDecodeError:
                # Fallback to latin-1 if utf-8 fails
                with open(file_path, 'r', encoding='latin-1') as file:
                    full_text = file.read()

            # Split into chunks
            text_chunks = self.text_splitter.split_text(full_text)

            for idx, chunk in enumerate(text_chunks):
                chunks.append({
                    'text': chunk,
                    'metadata': {
                        **metadata,
                        'chunk_index': idx,
                        'total_chunks': len(text_chunks),
                    }
                })

        except Exception as e:
            raise Exception(f"Error processing TXT: {str(e)}")

        return chunks

    def _process_zip(self, file_path: str) -> List[Dict[str, any]]:
        """Extract and process generic ZIP file containing supported documents"""
        chunks = []
        temp_dir = tempfile.mkdtemp()

        try:
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)

                # Walk through extracted files
                files_to_process = []
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        # Skip hidden files
                        if file.startswith('.'):
                            continue

                        ext = Path(file).suffix.lower()
                        if ext in ['.pdf', '.epub', '.txt']:
                            files_to_process.append(full_path)

                # Sort files to ensure deterministic order (important for chapters)
                files_to_process.sort()

                for processed_path in files_to_process:
                    try:
                        file_chunks = self.process_file(processed_path)
                        # Adjust metadata to reflect it came from a zip
                        for chunk in file_chunks:
                            # Preserve original source filename but note it's from a batch
                            chunk['metadata']['batch_source'] = Path(file_path).name
                        chunks.extend(file_chunks)
                    except Exception as e:
                        print(f"Warning: Failed to process file {processed_path} in zip: {e}")

        except Exception as e:
            raise Exception(f"Error processing ZIP: {str(e)}")
        finally:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

        return chunks
