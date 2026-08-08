#!/usr/bin/env python3
"""Build the Cockroach Browser technical white paper from docs/whitepaper.md."""

from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "whitepaper.md"
OUTPUT = ROOT / "output" / "pdf" / "Cockroach-Browser-Technical-White-Paper-v1.1.pdf"
PUBLIC_COPY = ROOT / "docs" / OUTPUT.name
SITE_COPY = ROOT / "site" / "paper" / OUTPUT.name
LOGO = ROOT / "site" / "assets" / "logo.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 24 * mm
RIGHT = 20 * mm
TOP = 22 * mm
BOTTOM = 19 * mm
WIDTH = PAGE_WIDTH - LEFT - RIGHT

INK = colors.HexColor("#07100F")
PAPER = colors.HexColor("#F5F7F4")
WHITE = colors.HexColor("#F8FBF9")
MUTED = colors.HexColor("#53615D")
GREEN = colors.HexColor("#00E7BD")
DARK_GREEN = colors.HexColor("#08765F")
RULE = colors.HexColor("#C8D5D0")
CODE_BG = colors.HexColor("#071310")

rl_config.invariant = 1


def register_fonts() -> tuple[str, str, str, str]:
    choices = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf",
         "C:/Windows/Fonts/ariali.ttf", "C:/Windows/Fonts/consola.ttf"),
        ("C:/Windows/Fonts/calibri.ttf", "C:/Windows/Fonts/calibrib.ttf",
         "C:/Windows/Fonts/calibrii.ttf", "C:/Windows/Fonts/consola.ttf"),
    ]
    for regular, bold, italic, mono in choices:
        paths = [Path(value) for value in (regular, bold, italic, mono)]
        if all(path.exists() for path in paths):
            pdfmetrics.registerFont(TTFont("CBBody", str(paths[0])))
            pdfmetrics.registerFont(TTFont("CBBody-Bold", str(paths[1])))
            pdfmetrics.registerFont(TTFont("CBBody-Italic", str(paths[2])))
            pdfmetrics.registerFont(TTFont("CBMono", str(paths[3])))
            pdfmetrics.registerFontFamily(
                "CBBody",
                normal="CBBody",
                bold="CBBody-Bold",
                italic="CBBody-Italic",
                boldItalic="CBBody-Bold",
            )
            return "CBBody", "CBBody-Bold", "CBBody-Italic", "CBMono"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Courier"


BODY, BOLD, ITALIC, MONO = register_fonts()
BASE = getSampleStyleSheet()
STYLES = {
    "cover-kicker": ParagraphStyle(
        "CoverKicker", parent=BASE["Normal"], fontName=BOLD, fontSize=9,
        leading=12, textColor=GREEN, spaceAfter=8 * mm,
    ),
    "cover-title": ParagraphStyle(
        "CoverTitle", parent=BASE["Title"], fontName=BOLD, fontSize=31,
        leading=35, textColor=WHITE, spaceAfter=5 * mm,
    ),
    "cover-subtitle": ParagraphStyle(
        "CoverSubtitle", parent=BASE["Normal"], fontName=BODY, fontSize=14,
        leading=20, textColor=colors.HexColor("#B7C7C2"), spaceAfter=11 * mm,
    ),
    "cover-meta": ParagraphStyle(
        "CoverMeta", parent=BASE["Normal"], fontName=BODY, fontSize=9,
        leading=14, textColor=colors.HexColor("#A9B8B3"),
    ),
    "h1": ParagraphStyle(
        "PaperH1", parent=BASE["Heading1"], fontName=BOLD, fontSize=20,
        leading=24, textColor=INK, spaceBefore=7 * mm, spaceAfter=3 * mm,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        "PaperH2", parent=BASE["Heading2"], fontName=BOLD, fontSize=13,
        leading=17, textColor=DARK_GREEN, spaceBefore=5 * mm,
        spaceAfter=2.5 * mm, keepWithNext=True,
    ),
    "body": ParagraphStyle(
        "PaperBody", parent=BASE["BodyText"], fontName=BODY, fontSize=9.3,
        leading=14, textColor=INK, spaceAfter=2.8 * mm,
        allowWidows=0, allowOrphans=0,
    ),
    "small": ParagraphStyle(
        "PaperSmall", parent=BASE["BodyText"], fontName=BODY, fontSize=7.4,
        leading=10, textColor=MUTED,
    ),
    "code": ParagraphStyle(
        "PaperCode", parent=BASE["Code"], fontName=MONO, fontSize=7.2,
        leading=10, textColor=WHITE, splitLongWords=True,
    ),
    "toc-title": ParagraphStyle(
        "TocTitle", parent=BASE["Heading1"], fontName=BOLD, fontSize=22,
        leading=26, textColor=INK, spaceAfter=7 * mm,
    ),
}


class PaperTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=LEFT,
            rightMargin=RIGHT,
            topMargin=TOP,
            bottomMargin=BOTTOM,
            title="Cockroach Browser: A Local-First Browser Runtime for AI Agents",
            author="Ajnas N B",
            subject="A local-first, authenticated browser runtime for AI agents",
            creator="Cockroach Browser white-paper build",
            pageCompression=1,
        )
        cover = Frame(LEFT, BOTTOM, WIDTH, PAGE_HEIGHT - BOTTOM - 14 * mm,
                      id="cover", leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        body = Frame(LEFT, BOTTOM, WIDTH, PAGE_HEIGHT - TOP - BOTTOM,
                     id="body", leftPadding=0, rightPadding=0,
                     topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="Cover", frames=[cover], onPage=self.cover_page),
            PageTemplate(id="Body", frames=[body], onPage=self.body_page),
        ])

    @staticmethod
    def cover_page(canvas, _doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#020706"))
        canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
        canvas.setFillColor(GREEN)
        canvas.rect(0, PAGE_HEIGHT - 7 * mm, PAGE_WIDTH, 7 * mm, stroke=0, fill=1)
        canvas.setStrokeColor(colors.HexColor("#18302B"))
        canvas.line(LEFT, 16 * mm, PAGE_WIDTH - RIGHT, 16 * mm)
        canvas.setFillColor(colors.HexColor("#91A49E"))
        canvas.setFont(MONO, 7.2)
        canvas.drawString(LEFT, 10 * mm, "COCKROACH BROWSER / TECHNICAL PAPER")
        canvas.drawRightString(PAGE_WIDTH - RIGHT, 10 * mm, "AUGUST 2026")
        canvas.restoreState()

    @staticmethod
    def body_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
        canvas.setStrokeColor(RULE)
        canvas.line(LEFT, PAGE_HEIGHT - 14 * mm, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 14 * mm)
        canvas.setFont(BOLD, 7.2)
        canvas.setFillColor(DARK_GREEN)
        canvas.drawString(LEFT, PAGE_HEIGHT - 10 * mm, "COCKROACH BROWSER")
        canvas.setFont(BODY, 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 10 * mm,
                               "CAPABILITY WITHOUT AMBIENT AUTHORITY")
        canvas.setStrokeColor(RULE)
        canvas.line(LEFT, 13 * mm, PAGE_WIDTH - RIGHT, 13 * mm)
        canvas.setFont(BODY, 7.2)
        canvas.drawString(LEFT, 8 * mm, "Ajnas N B - Technical white paper v1.1")
        canvas.drawRightString(PAGE_WIDTH - RIGHT, 8 * mm, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "_toc_level", None)
        if level is None:
            return
        title = flowable.getPlainText()
        key = f"section-{self.seq.nextf('heading')}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title, key, level=level, closed=False)
        self.notify("TOCEntry", (level, title, self.page, key))


def inline(value: str) -> str:
    protected: dict[str, str] = {}

    def reserve(fragment: str) -> str:
        token = f"CBPLACEHOLDER{len(protected)}TOKEN"
        protected[token] = fragment
        return token

    value = re.sub(
        r"`([^`]+)`",
        lambda match: reserve(
            f'<font name="{MONO}" color="#08765F">{html.escape(match.group(1))}</font>'
        ),
        value,
    )
    value = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: reserve(
            f'<link href="{html.escape(match.group(2), quote=True)}" '
            f'color="#08765F"><u>{html.escape(match.group(1))}</u></link>'
        ),
        value,
    )
    value = html.escape(value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", value)
    for token, fragment in protected.items():
        value = value.replace(token, fragment)
    return value


def heading(value: str, level: int) -> Paragraph:
    paragraph = Paragraph(inline(value), STYLES["h1" if level == 2 else "h2"])
    paragraph._toc_level = 0 if level == 2 else 1
    return paragraph


def code_block(value: str) -> Table:
    pre = Preformatted(value, STYLES["code"], maxLineLength=96)
    table = Table([[pre]], colWidths=[WIDTH], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, DARK_GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    return table


def parse_markdown(text: str) -> list:
    lines = text.splitlines()
    story: list = []
    paragraph: list[str] = []
    code: list[str] = []
    in_code = False

    def flush():
        if paragraph:
            story.append(Paragraph(inline(" ".join(line.strip() for line in paragraph)),
                                   STYLES["body"]))
            paragraph.clear()

    index = 0
    while index < len(lines):
        raw = lines[index]
        line = raw.rstrip()
        if line.startswith("```"):
            if in_code:
                story.append(code_block("\n".join(code)))
                code.clear()
                in_code = False
            else:
                flush()
                in_code = True
            index += 1
            continue
        if in_code:
            code.append(raw)
            index += 1
            continue
        match = re.match(r"^(#{2,3})\s+(.+)$", line)
        if match:
            flush()
            story.append(heading(match.group(2), len(match.group(1))))
            index += 1
            continue
        if re.match(r"^(?:- |\d+\. )", line):
            flush()
            ordered = bool(re.match(r"^\d+\.", line))
            item_values: list[str] = []
            while index < len(lines) and re.match(r"^(?:- |\d+\. )", lines[index]):
                item = re.sub(r"^(?:- |\d+\. )", "", lines[index]).strip()
                item_values.append(item)
                index += 1
            if ordered:
                numbered = Table(
                    [
                        [
                            Paragraph(str(number), STYLES["body"]),
                            Paragraph(inline(item), STYLES["body"]),
                        ]
                        for number, item in enumerate(item_values, start=1)
                    ],
                    colWidths=[7 * mm, WIDTH - 7 * mm],
                    hAlign="LEFT",
                )
                numbered.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]))
                story.append(numbered)
                story.append(Spacer(1, 2.5 * mm))
            else:
                bulleted = Table(
                    [
                        [
                            Paragraph("&#8226;", STYLES["body"]),
                            Paragraph(inline(item), STYLES["body"]),
                        ]
                        for item in item_values
                    ],
                    colWidths=[5 * mm, WIDTH - 5 * mm],
                    hAlign="LEFT",
                    splitByRow=True,
                )
                bulleted.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8 * mm),
                ]))
                story.append(bulleted)
                story.append(Spacer(1, 1.7 * mm))
            continue
        if not line.strip():
            flush()
        elif line.startswith("**") and line.endswith("  "):
            flush()
            story.append(Paragraph(inline(line.strip()), STYLES["body"]))
        else:
            paragraph.append(line)
        index += 1
    flush()
    return story


def cover_story() -> list:
    logo = Image(str(LOGO), 51 * mm, 51 * mm)
    logo.hAlign = "LEFT"
    return [
        Spacer(1, 19 * mm),
        logo,
        Spacer(1, 10 * mm),
        Paragraph("COCKROACH BROWSER / VERSION 0.3.0", STYLES["cover-kicker"]),
        Paragraph("A local-first browser runtime for AI agents", STYLES["cover-title"]),
        Paragraph(
            "The browser runtime your AI agents can use without inheriting your whole machine.",
            STYLES["cover-subtitle"],
        ),
        HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#24433C")),
        Spacer(1, 8 * mm),
        Paragraph(
            "<b>Author:</b> Ajnas N B<br/>"
            "<b>Paper version:</b> 1.1<br/>"
            "<b>Date:</b> August 2026<br/>"
            "<b>Concept DOI:</b> 10.5281/zenodo.21701791<br/>"
            "<b>Software:</b> AGPL-3.0-or-later<br/>"
            "<b>Paper:</b> Creative Commons Attribution 4.0 International<br/>"
            "<b>Status:</b> Implementation-backed technical white paper. "
            "The paper has not undergone independent peer review or independent security certification.",
            STYLES["cover-meta"],
        ),
        NextPageTemplate("Body"),
        PageBreak(),
    ]


def toc_story() -> list:
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOC1", fontName=BOLD, fontSize=8.8, leading=11.2,
            textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=0.5,
        ),
        ParagraphStyle(
            "TOC2", fontName=BODY, fontSize=7.4, leading=9.4,
            textColor=MUTED, leftIndent=8 * mm, firstLineIndent=0,
        ),
    ]
    return [
        Paragraph("Contents", STYLES["toc-title"]),
        Paragraph(
            "Implementation, authority boundaries, integrations, deployment, and verification.",
            STYLES["body"],
        ),
        Spacer(1, 3 * mm),
        toc,
        PageBreak(),
    ]


def build() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    start = text.find("## Abstract")
    if start < 0:
        raise ValueError("docs/whitepaper.md does not contain an Abstract section")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    story = cover_story() + toc_story() + parse_markdown(text[start:])
    PaperTemplate(str(OUTPUT)).multiBuild(story)
    shutil.copyfile(OUTPUT, PUBLIC_COPY)
    shutil.copyfile(OUTPUT, SITE_COPY)
    print(OUTPUT)


if __name__ == "__main__":
    build()
