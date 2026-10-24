"""Builds realistic Office fixtures for the file-engine tests.

Each file is written by a real producer (python-docx, openpyxl, python-pptx,
then re-saved by LibreOffice and macOS textutil), so the tests see the XML
quirks of real documents: names split across formatting runs, tables,
headers, comments, author metadata and numbers stored as numbers.

Usage: python3 tests/fixtures/make-fixtures.py   (needs python-docx, openpyxl,
python-pptx; LibreOffice's soffice and textutil are optional)
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import docx
import openpyxl
import pptx
from docx.shared import Pt

OUT = Path(__file__).resolve().parent


def make_docx(path: Path) -> None:
    document = docx.Document()
    document.core_properties.author = "Maria Gonzalez"
    document.core_properties.last_modified_by = "Maria Gonzalez"
    document.core_properties.title = "Refund for Northwind Traders"
    document.sections[0].header.paragraphs[0].text = "Confidential - prepared by Maria Gonzalez"

    para = document.add_paragraph("Please call ")
    para.add_run("Maria").bold = True
    para.add_run(" Gonzalez").italic = True
    para.add_run(" at maria.gonzalez@northwind.example or +44 20 7946 0958.")

    para = document.add_paragraph()
    run = para.add_run("Northwind ")
    run.font.size = Pt(14)
    para.add_run("Traders paid with card 4111 1111 1111 1111.")

    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Contact"
    table.cell(0, 1).text = "Phone"
    table.cell(1, 0).text = "Maria Gonzalez"
    table.cell(1, 1).text = "+44 20 7946 0958"

    target = document.paragraphs[1]
    document.add_comment(target.runs, text="Check with Maria Gonzalez first", author="Maria Gonzalez", initials="MG")
    document.save(path)


def make_xlsx(path: Path) -> None:
    book = openpyxl.Workbook()
    book.properties.creator = "Maria Gonzalez"
    sheet = book.active
    sheet.title = "Contacts"
    sheet.append(["Name", "Email", "Phone (text)", "Phone (number)", "Company"])
    sheet.append(["Maria Gonzalez", "maria.gonzalez@northwind.example", "+44 20 7946 0958", 442079460958, "Northwind Traders"])
    sheet.append(["Total", None, None, None, None])
    book.save(path)


def make_pptx(path: Path) -> None:
    deck = pptx.Presentation()
    deck.core_properties.author = "Maria Gonzalez"
    slide = deck.slides.add_slide(deck.slide_layouts[1])
    slide.shapes.title.text = "Account review: Northwind Traders"
    body = slide.placeholders[1].text_frame
    body.text = "Owner: Maria Gonzalez"
    body.add_paragraph().text = "Email maria.gonzalez@northwind.example"
    slide.notes_slide.notes_text_frame.text = "Mention that Maria Gonzalez approved the refund."
    deck.save(path)


def libreoffice_resave(source: Path, target: Path, fmt: str) -> bool:
    soffice = shutil.which("soffice")
    if not soffice:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [soffice, "--headless", "--convert-to", fmt, "--outdir", tmp, str(source)],
            check=True, capture_output=True, timeout=120,
        )
        produced = Path(tmp) / f"{source.stem}.{fmt}"
        shutil.move(produced, target)
    return True


def textutil_docx(target: Path) -> bool:
    if not shutil.which("textutil"):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "note.html"
        html.write_text(
            "<p>Dear <b>Maria</b> Gonzalez,</p>"
            "<p>Your IBAN GB82 WEST 1234 5698 7654 32 is on file at Northwind Traders.</p>",
            encoding="utf-8",
        )
        subprocess.run(["textutil", "-convert", "docx", "-output", str(target), str(html)], check=True, timeout=60)
    return True


def main() -> None:
    made = []
    make_docx(OUT / "python-docx.docx")
    make_xlsx(OUT / "openpyxl.xlsx")
    make_pptx(OUT / "python-pptx.pptx")
    made += ["python-docx.docx", "openpyxl.xlsx", "python-pptx.pptx"]
    if libreoffice_resave(OUT / "python-docx.docx", OUT / "libreoffice.docx", "docx"):
        made.append("libreoffice.docx")
    if libreoffice_resave(OUT / "openpyxl.xlsx", OUT / "libreoffice.xlsx", "xlsx"):
        made.append("libreoffice.xlsx")
    if textutil_docx(OUT / "textutil.docx"):
        made.append("textutil.docx")
    print("wrote " + ", ".join(made))


if __name__ == "__main__":
    main()
