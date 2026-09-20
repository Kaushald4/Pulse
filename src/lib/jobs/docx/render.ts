/**
 * Plain-text resume → `.docx`, returned base64 so it can go straight to the
 * native save dialog.
 *
 * Every visual property is set explicitly rather than through Word's built-in
 * heading styles: `heading: HeadingLevel.*` pulls the active Word theme's
 * colour and font, which is what made earlier output change appearance between
 * generations. Blank source lines are dropped - spacing comes from paragraph
 * properties, not empty paragraphs.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from "docx";
import { isHeadingLine, isPlainListLine, LINK_RE, parseTitleDate, TAG_LIST_SECTIONS, toHref } from "./rules";

const FONT = "Calibri";
const TEXT_COLOR = "000000";
const MUTED_COLOR = "595959";
const HEADING_COLOR = "44546A";
const LINK_COLOR = "000000";

const NAME_SIZE = 32;
const TITLE_SIZE = 26;
const HEADING_SIZE = 22;
const BODY_SIZE = 22;
const COMPANY_SIZE = 24;
const CONTACT_SIZE = 20;
const BULLET_GLYPH_SIZE = 14;

const BULLET_REFERENCE = "resume-bullet";

function buildLineRuns(
  text: string,
  size: number,
  options: { bold?: boolean; color?: string } = {}
): ParagraphChild[] {
  const { bold = false, color = TEXT_COLOR } = options;
  const runs: ParagraphChild[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, start), font: FONT, size, bold, color }));
    }
    runs.push(
      new ExternalHyperlink({
        link: toHref(raw),
        children: [
          new TextRun({
            text: raw,
            font: FONT,
            size,
            bold,
            color: LINK_COLOR,
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      })
    );
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length || runs.length === 0) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font: FONT, size, bold, color }));
  }
  return runs;
}

/** Bold and larger than the title beside it, with space above so jobs separate. */
function companyParagraph(name: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 20 },
    children: [new TextRun({ text: name, font: FONT, size: COMPANY_SIZE, bold: true, color: TEXT_COLOR })],
  });
}

/** Title left, date right via a right tab stop - still plain text underneath. */
function titleDateParagraph(title: string, date: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { after: 60 },
    children: [
      new TextRun({ text: title, font: FONT, size: BODY_SIZE, bold: true, color: TEXT_COLOR }),
      new TextRun({ text: `\t${date}`, font: FONT, size: BODY_SIZE, color: MUTED_COLOR }),
    ],
  });
}

function centred(text: string, size: number, spacingAfter: number, bold = true): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: spacingAfter },
    children: [new TextRun({ text, font: FONT, size, bold, color: TEXT_COLOR })],
  });
}

function buildBody(lines: string[]): Paragraph[] {
  const children: Paragraph[] = [];
  let currentSection = "";
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (isHeadingLine(line)) {
      // A real empty paragraph, not just `spacing.before` - paragraph-spacing
      // metadata alone did not read as a visible gap between sections.
      if (children.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "", font: FONT, size: BODY_SIZE })] }));
      }
      children.push(
        new Paragraph({
          spacing: { before: 60, after: 100 },
          children: [new TextRun({ text: line, font: FONT, size: HEADING_SIZE, bold: true, color: HEADING_COLOR })],
        })
      );
      currentSection = line.toLowerCase();
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      children.push(
        new Paragraph({
          numbering: { reference: BULLET_REFERENCE, level: 0 },
          spacing: { after: 40 },
          children: buildLineRuns(line.slice(2).trim(), BODY_SIZE),
        })
      );
      index += 1;
      continue;
    }

    // Inside a flat-list section, a run of bare lines is one item per line
    // rather than prose - collapse it into a single comma-separated paragraph.
    if (TAG_LIST_SECTIONS.has(currentSection) && isPlainListLine(line)) {
      const group: string[] = [];
      while (index < lines.length && isPlainListLine(lines[index])) {
        group.push(lines[index]);
        index += 1;
      }
      children.push(
        new Paragraph({ spacing: { after: 80 }, children: buildLineRuns(group.join(", "), BODY_SIZE) })
      );
      continue;
    }

    // Company line followed by "Title | Date range" - the two-line job header.
    const next = lines[index + 1];
    const nextTitleDate = next && !isHeadingLine(next) && !next.startsWith("- ") ? parseTitleDate(next) : null;
    if (nextTitleDate && !parseTitleDate(line) && !isHeadingLine(line) && !line.startsWith("- ")) {
      children.push(companyParagraph(line));
      children.push(titleDateParagraph(nextTitleDate.title, nextTitleDate.date));
      index += 2;
      continue;
    }

    const ownTitleDate = parseTitleDate(line);
    if (ownTitleDate) {
      children.push(titleDateParagraph(ownTitleDate.title, ownTitleDate.date));
      index += 1;
      continue;
    }

    children.push(new Paragraph({ spacing: { after: 80 }, children: buildLineRuns(line, BODY_SIZE) }));
    index += 1;
  }

  return children;
}

/** Renders resume text into a base64 `.docx`. */
export async function renderTextToDocx(content: string): Promise<string> {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let children: Paragraph[];
  if (lines.length === 0) {
    children = [new Paragraph({ children: [new TextRun({ text: content, font: FONT, size: BODY_SIZE })] })];
  } else {
    const [name, title, contact, ...rest] = lines;
    children = [
      centred(name, NAME_SIZE, 40),
      ...(title ? [centred(title, TITLE_SIZE, 80)] : []),
      ...(contact
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: buildLineRuns(contact, CONTACT_SIZE),
            }),
          ]
        : []),
      ...buildBody(rest),
    ];
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                run: { font: FONT, size: BULLET_GLYPH_SIZE },
                paragraph: { indent: { left: 360, hanging: 260 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          // Tighter than Word's 1" default, which read as too much whitespace.
          page: { margin: { top: 576, bottom: 576, left: 720, right: 720 } },
        },
        children,
      },
    ],
  });

  return Packer.toBase64String(document);
}
