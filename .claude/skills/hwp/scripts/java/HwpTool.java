import kr.dogfoot.hwpxlib.object.HWPXFile;
import kr.dogfoot.hwpxlib.object.content.header_xml.enumtype.LineType2;
import kr.dogfoot.hwpxlib.object.content.header_xml.enumtype.LineWidth;
import kr.dogfoot.hwpxlib.object.content.header_xml.references.BorderFill;
import kr.dogfoot.hwpxlib.object.content.header_xml.references.CharPr;
import kr.dogfoot.hwpxlib.object.content.section_xml.SectionXMLFile;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.Para;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.Run;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.T;
import kr.dogfoot.hwpxlib.reader.HWPXReader;
import kr.dogfoot.hwpxlib.tool.blankfilemaker.BlankFileMaker;
import kr.dogfoot.hwpxlib.tool.textextractor.TextExtractMethod;
import kr.dogfoot.hwpxlib.tool.textextractor.TextExtractor;
import kr.dogfoot.hwpxlib.writer.HWPXWriter;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 마크다운을 한글 문서(.hwpx)로 바꾸고, 한글 문서에서 글을 뽑아낸다.
 *
 *   java HwpTool create <입력.md> <출력.hwpx>
 *   java HwpTool read   <파일.hwpx>
 *
 * 마크다운을 입력으로 삼는 이유는 단순하다. 모델이 가장 자연스럽게 쓰는 형식이고,
 * 사람이 눈으로 검토하기도 쉽다. 중간 표현을 따로 발명할 이유가 없다.
 */
public class HwpTool {

    /* 글자 크기는 1/100 pt 단위다. 1000 = 10pt */
    private static final int SIZE_BODY = 1000;
    private static final int SIZE_H1 = 1800;
    private static final int SIZE_H2 = 1400;
    private static final int SIZE_H3 = 1200;

    /* BlankFileMaker 가 만들어 주는 기본 스타일 번호 */
    private static final String STYLE_BODY = "0";   // 바탕글
    private static final String STYLE_H1 = "2";     // 개요 1
    private static final String STYLE_H2 = "3";     // 개요 2
    private static final String STYLE_H3 = "4";     // 개요 3
    private static final String PARA_BODY = "3";    // 바탕글이 쓰는 문단모양

    /** 만들어 둔 글자모양 번호 */
    private String cpBody, cpBold, cpH1, cpH2, cpH3;

    /** 만들어 둔 테두리 번호. 빈 문서에는 테두리 없는 것만 있어서 새로 만든다. */
    private String bfCell, bfHeader;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("사용법:");
            System.err.println("  java HwpTool create <입력.md> <출력.hwpx> [문서제목]");
            System.err.println("  java HwpTool read   <파일.hwpx>");
            System.exit(2);
        }

        String cmd = args[0];
        if ("create".equals(cmd)) {
            if (args.length < 3) {
                System.err.println("create 는 입력과 출력 경로가 모두 필요합니다.");
                System.exit(2);
            }
            String markdown = new String(Files.readAllBytes(Paths.get(args[1])), StandardCharsets.UTF_8);
            new HwpTool().create(markdown, args[2]);
            System.out.println("만들었습니다: " + args[2]);
            System.out.println("크기: " + Files.size(Paths.get(args[2])) + " 바이트");
        } else if ("read".equals(cmd)) {
            Path p = Paths.get(args[1]);
            if (!Files.exists(p)) {
                System.err.println("파일이 없습니다: " + args[1]);
                System.exit(1);
            }
            HWPXFile file = HWPXReader.fromFilepath(args[1]);
            String text = TextExtractor.extract(
                    file, TextExtractMethod.InsertControlTextBetweenParagraphText, true, null);
            System.out.println(text);
        } else {
            System.err.println("모르는 명령입니다: " + cmd);
            System.exit(2);
        }
    }

    /* ------------------------------------------------------------------ */

    void create(String markdown, String outPath) throws Exception {
        HWPXFile file = BlankFileMaker.make();
        prepareCharStyles(file);
        prepareBorderFills(file);

        SectionXMLFile section = file.sectionXMLFileList().get(0);
        List<String> lines = splitLines(markdown);

        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);

            // 표는 여러 줄이 한 덩어리다. 만나면 통째로 먹는다.
            if (isTableRow(line) && i + 1 < lines.size() && isTableDivider(lines.get(i + 1))) {
                List<String> block = new ArrayList<>();
                while (i < lines.size() && isTableRow(lines.get(i))) {
                    block.add(lines.get(i));
                    i++;
                }
                i--;
                addTable(section, block);
                continue;
            }

            addLine(section, line);
        }

        HWPXWriter.toFilepath(file, outPath);
    }

    /**
     * 제목과 굵은 글씨에 쓸 글자모양을 미리 만들어 둔다.
     * 빈 문서에는 10pt 보통 글씨 하나뿐이라, 크기와 굵기만 바꾼 사본을 붙인다.
     */
    private void prepareCharStyles(HWPXFile file) {
        var props = file.headerXMLFile().refList().charProperties();
        CharPr base = props.get(0);

        cpBody = base.id();
        cpBold = addCharPr(props, base, SIZE_BODY, true);
        cpH1 = addCharPr(props, base, SIZE_H1, true);
        cpH2 = addCharPr(props, base, SIZE_H2, true);
        cpH3 = addCharPr(props, base, SIZE_H3, true);
    }

    /**
     * 표에 쓸 테두리를 만든다.
     *
     * 빈 문서가 갖고 있는 테두리(id 1, 2)는 네 변이 모두 NONE 이라, 그대로 쓰면
     * 표가 그려지긴 해도 선이 없어서 탭으로 맞춘 글처럼 보인다. 실무 문서로는
     * 쓸 수 없으므로 실선 테두리를 새로 만들고, 제목 행은 옅은 회색을 깐다.
     */
    private void prepareBorderFills(HWPXFile file) {
        var fills = file.headerXMLFile().refList().borderFills();
        bfCell = addBorderFill(fills, null);
        bfHeader = addBorderFill(fills, "#EEEEEE");
    }

    private String addBorderFill(kr.dogfoot.hwpxlib.object.common.ObjectList<BorderFill> fills,
                                 String faceColor) {
        BorderFill bf = fills.get(0).clone();
        String id = String.valueOf(fills.count() + 1); // 번호는 1부터 시작한다
        bf.id(id);
        bf.threeD(false);
        bf.shadow(false);
        bf.breakCellSeparateLine(false);

        bf.createLeftBorder();
        solid(bf.leftBorder());
        bf.createRightBorder();
        solid(bf.rightBorder());
        bf.createTopBorder();
        solid(bf.topBorder());
        bf.createBottomBorder();
        solid(bf.bottomBorder());

        if (faceColor != null) {
            bf.createFillBrush();
            bf.fillBrush().createWinBrush();
            bf.fillBrush().winBrush().faceColor(faceColor);
            bf.fillBrush().winBrush().hatchColor("#999999");
            bf.fillBrush().winBrush().alpha(0f);
        }
        fills.add(bf);
        return id;
    }

    private void solid(kr.dogfoot.hwpxlib.object.content.header_xml.references.borderfill.Border b) {
        b.type(LineType2.SOLID);
        b.width(LineWidth.MM_0_12);
        b.color("#000000");
    }

    private String addCharPr(kr.dogfoot.hwpxlib.object.common.ObjectList<CharPr> props,
                             CharPr base, int height, boolean bold) {
        CharPr cp = base.clone();
        String id = String.valueOf(props.count());
        cp.id(id);
        cp.height(height);
        if (bold) cp.createBold();
        else cp.removeBold();
        props.add(cp);
        return id;
    }

    /* ------------------------------------------------------------------ */

    private void addLine(SectionXMLFile section, String line) {
        String trimmed = line.trim();

        if (trimmed.isEmpty()) {
            addPara(section, STYLE_BODY, PARA_BODY, cpBody, "");
            return;
        }

        Matcher h = Pattern.compile("^(#{1,3})\\s+(.*)$").matcher(trimmed);
        if (h.matches()) {
            int level = h.group(1).length();
            String text = h.group(2).trim();
            switch (level) {
                case 1: addRich(section, STYLE_H1, PARA_BODY, cpH1, text); return;
                case 2: addRich(section, STYLE_H2, PARA_BODY, cpH2, text); return;
                default: addRich(section, STYLE_H3, PARA_BODY, cpH3, text); return;
            }
        }

        // 불릿과 번호 목록은 한글에서 자동 번호를 쓰면 서식이 튀는 일이 잦다.
        // 눈에 보이는 글머리표를 그대로 넣는 편이 결과가 예측 가능하다.
        Matcher bullet = Pattern.compile("^[-*+]\\s+(.*)$").matcher(trimmed);
        if (bullet.matches()) {
            addRich(section, STYLE_BODY, PARA_BODY, cpBody, "· " + bullet.group(1).trim());
            return;
        }

        Matcher numbered = Pattern.compile("^(\\d+)[.)]\\s+(.*)$").matcher(trimmed);
        if (numbered.matches()) {
            addRich(section, STYLE_BODY, PARA_BODY, cpBody,
                    numbered.group(1) + ". " + numbered.group(2).trim());
            return;
        }

        // 수평선은 한글에 딱 맞는 표현이 없다. 옅은 구분줄로 대신한다.
        if (trimmed.matches("^(-{3,}|_{3,}|\\*{3,})$")) {
            addPara(section, STYLE_BODY, PARA_BODY, cpBody, "──────────");
            return;
        }

        addRich(section, STYLE_BODY, PARA_BODY, cpBody, trimmed);
    }

    /** **굵게** 표시를 살려서 한 문단을 넣는다. */
    private void addRich(SectionXMLFile section, String styleId, String paraId,
                         String normalCharPr, String text) {
        Para para = section.addNewPara();
        para.paraPrIDRef(paraId);
        para.styleIDRef(styleId);

        Matcher m = Pattern.compile("\\*\\*(.+?)\\*\\*").matcher(text);
        int last = 0;
        boolean any = false;

        while (m.find()) {
            any = true;
            if (m.start() > last) {
                addRun(para, normalCharPr, text.substring(last, m.start()));
            }
            // 제목처럼 이미 굵은 글씨 안에서는 그대로 두고, 본문에서만 굵게 바꾼다
            addRun(para, normalCharPr.equals(cpBody) ? cpBold : normalCharPr, m.group(1));
            last = m.end();
        }
        if (last < text.length()) {
            addRun(para, normalCharPr, text.substring(last));
        }
        if (!any && text.isEmpty()) {
            addRun(para, normalCharPr, "");
        }
    }

    private void addPara(SectionXMLFile section, String styleId, String paraId,
                         String charPr, String text) {
        Para para = section.addNewPara();
        para.paraPrIDRef(paraId);
        para.styleIDRef(styleId);
        addRun(para, charPr, text);
    }

    private void addRun(Para para, String charPr, String text) {
        Run run = para.addNewRun();
        run.charPrIDRef(charPr);
        T t = run.addNewT();
        t.addText(text);
    }

    /* ------------------------------------------------------------------ *
     * 표
     * ------------------------------------------------------------------ */

    private boolean isTableRow(String line) {
        String t = line.trim();
        return t.startsWith("|") && t.endsWith("|") && t.length() > 2;
    }

    private boolean isTableDivider(String line) {
        String t = line.trim();
        if (!isTableRow(t)) return false;
        return t.replaceAll("[|\\s:-]", "").isEmpty();
    }

    private List<String> parseRow(String line) {
        String t = line.trim();
        t = t.substring(1, t.length() - 1); // 양끝 | 제거
        List<String> cells = new ArrayList<>();
        for (String c : t.split("\\|", -1)) cells.add(c.trim());
        return cells;
    }

    /**
     * 마크다운 표를 한글 표로 옮긴다.
     *
     * 표는 셀 주소·칸 수·너비를 모두 명시해야 한글이 제대로 그린다.
     * 하나라도 빠지면 문서는 열리지만 표가 무너져 보인다.
     *
     * 열 너비는 균등분할하지 않는다. "번호" 열과 "내용" 열이 같은 폭이면
     * 한쪽은 텅 비고 다른 쪽은 글이 접혀서 읽기 나쁘다. 각 열에서 가장 긴
     * 내용을 재서 그 비율대로 나눈다.
     */
    private void addTable(SectionXMLFile section, List<String> block) {
        List<List<String>> rows = new ArrayList<>();
        for (int i = 0; i < block.size(); i++) {
            if (i == 1 && isTableDivider(block.get(i))) continue; // 구분줄은 건너뛴다
            rows.add(parseRow(block.get(i)));
        }
        if (rows.isEmpty()) return;

        int cols = 0;
        for (List<String> r : rows) cols = Math.max(cols, r.size());
        if (cols == 0) return;

        // 본문 폭(A4 기본 여백 기준). 단위는 1/7200 인치.
        final long totalWidth = 42520L;
        long[] colWidth = shareWidth(rows, cols, totalWidth);

        // 각 행의 높이는 그 행에서 가장 많이 접히는 셀에 맞춘다.
        long[] rowHeight = new long[rows.size()];
        long tableHeight = 0;
        for (int r = 0; r < rows.size(); r++) {
            int maxLines = 1;
            List<String> cells = rows.get(r);
            for (int c = 0; c < cols && c < cells.size(); c++) {
                maxLines = Math.max(maxLines, wrappedLines(cells.get(c), colWidth[c]));
            }
            rowHeight[r] = 400L + maxLines * 620L; // 위아래 여백 + 줄당 높이
            tableHeight += rowHeight[r];
        }

        Para holder = section.addNewPara();
        holder.paraPrIDRef(PARA_BODY);
        holder.styleIDRef(STYLE_BODY);
        Run run = holder.addNewRun();
        run.charPrIDRef(cpBody);

        var table = run.addNewTable();
        table.rowCnt((short) rows.size());
        table.colCnt((short) cols);
        table.cellSpacing(0);
        table.borderFillIDRef(bfCell);
        // 표가 쪽 끝에 걸리면 행 단위로 넘기고, 새 쪽에서 제목 행을 다시 보여준다.
        table.pageBreak(kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.TablePageBreak.CELL);
        table.repeatHeader(true);

        table.createSZ();
        table.sz().width(totalWidth);
        table.sz().height(tableHeight);

        table.createPos();
        table.pos().treatAsChar(true);

        table.createOutMargin();
        table.outMargin().left(0L);
        table.outMargin().right(0L);
        table.outMargin().top(140L);
        table.outMargin().bottom(140L);

        table.createInMargin();
        table.inMargin().left(510L);
        table.inMargin().right(510L);
        table.inMargin().top(141L);
        table.inMargin().bottom(141L);

        for (int r = 0; r < rows.size(); r++) {
            var tr = table.addNewTr();
            List<String> cells = rows.get(r);
            boolean header = (r == 0);

            for (int c = 0; c < cols; c++) {
                String text = c < cells.size() ? cells.get(c) : "";
                var tc = tr.addNewTc();
                tc.header(header);
                tc.hasMargin(false);
                tc.protect(false);
                tc.editable(false);
                tc.dirty(false);
                tc.borderFillIDRef(header ? bfHeader : bfCell);

                tc.createCellAddr();
                tc.cellAddr().colAddr((short) c);
                tc.cellAddr().rowAddr((short) r);

                tc.createCellSpan();
                tc.cellSpan().colSpan((short) 1);
                tc.cellSpan().rowSpan((short) 1);

                tc.createCellSz();
                tc.cellSz().width(colWidth[c]);
                tc.cellSz().height(rowHeight[r]);

                tc.createCellMargin();
                tc.cellMargin().left(510L);
                tc.cellMargin().right(510L);
                tc.cellMargin().top(141L);
                tc.cellMargin().bottom(141L);

                tc.createSubList();
                var sub = tc.subList();
                sub.textDirection(kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.TextDirection.HORIZONTAL);
                sub.lineWrap(kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.LineWrapMethod.BREAK);
                sub.vertAlign(kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.VerticalAlign2.CENTER);

                Para cellPara = sub.addNewPara();
                cellPara.paraPrIDRef(PARA_BODY);
                cellPara.styleIDRef(STYLE_BODY);
                Run cellRun = cellPara.addNewRun();
                cellRun.charPrIDRef(header ? cpBold : cpBody);
                T t = cellRun.addNewT();
                t.addText(text);
            }
        }
    }

    /**
     * 열 너비를 내용 길이에 비례해서 나눈다.
     *
     * 한글은 좁아도 되고("번호", "구분") 어떤 열은 넓어야 한다("내용", "비고").
     * 다만 완전히 비례로만 두면 짧은 열이 지나치게 좁아져 글자가 세로로 서므로,
     * 최소 폭을 보장한다.
     */
    private long[] shareWidth(List<List<String>> rows, int cols, long total) {
        double[] weight = new double[cols];
        for (int c = 0; c < cols; c++) {
            double longest = 0;
            for (List<String> row : rows) {
                if (c < row.size()) longest = Math.max(longest, visualWidth(row.get(c)));
            }
            // 제곱근을 쓰면 긴 열이 화면을 독차지하지 않으면서도 여유를 갖는다
            weight[c] = Math.sqrt(Math.max(longest, 2));
        }

        double sum = 0;
        for (double w : weight) sum += w;

        long minWidth = Math.min(total / cols, 4200L); // 대략 두 글자 + 여백
        long[] out = new long[cols];
        long assigned = 0;
        for (int c = 0; c < cols; c++) {
            out[c] = Math.max(minWidth, (long) (total * weight[c] / sum));
            assigned += out[c];
        }

        // 최소 폭 보장 때문에 합이 어긋날 수 있다. 가장 넓은 열에서 조정한다.
        long diff = total - assigned;
        if (diff != 0) {
            int widest = 0;
            for (int c = 1; c < cols; c++) if (out[c] > out[widest]) widest = c;
            out[widest] += diff;
            if (out[widest] < minWidth) out[widest] = minWidth;
        }
        return out;
    }

    /** 한글은 두 칸, 영문·숫자는 한 칸으로 세어 실제 보이는 폭을 잰다. */
    private int visualWidth(String s) {
        int w = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            w += (ch >= 0x1100 && ch <= 0xD7A3) || (ch >= 0xFF00 && ch <= 0xFFEF) ? 2 : 1;
        }
        return w;
    }

    /** 주어진 폭에서 몇 줄로 접힐지 어림한다. 행 높이를 정하는 데 쓴다. */
    private int wrappedLines(String text, long cellWidth) {
        if (text.isEmpty()) return 1;
        // 10pt 글자 한 칸은 대략 1000 HWPUNIT. 좌우 여백 1020 을 뺀다.
        long usable = Math.max(cellWidth - 1020L, 1000L);
        int perLine = Math.max((int) (usable / 1000L), 1);
        return (int) Math.ceil((double) visualWidth(text) / perLine);
    }

    /* ------------------------------------------------------------------ */

    private List<String> splitLines(String s) {
        List<String> out = new ArrayList<>();
        for (String line : s.replace("\r\n", "\n").replace("\r", "\n").split("\n", -1)) {
            out.add(line);
        }
        // 끝의 빈 줄은 문서 뒤에 빈 문단만 남기므로 정리한다
        while (!out.isEmpty() && out.get(out.size() - 1).trim().isEmpty()) {
            out.remove(out.size() - 1);
        }
        return out;
    }
}
