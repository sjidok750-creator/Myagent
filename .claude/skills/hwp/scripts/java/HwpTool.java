import kr.dogfoot.hwpxlib.object.HWPXFile;
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
            addPara(section, STYLE_BODY, PARA_BODY, cpBody, "────────────────────────────");
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

        Para holder = section.addNewPara();
        holder.paraPrIDRef(PARA_BODY);
        holder.styleIDRef(STYLE_BODY);
        Run run = holder.addNewRun();
        run.charPrIDRef(cpBody);

        var table = run.addNewTable();
        table.rowCnt((short) rows.size());
        table.colCnt((short) cols);
        table.cellSpacing(0);
        table.borderFillIDRef("2");

        // 본문 폭(대략 A4 여백 제외)을 칸 수로 나눈다. 단위는 1/7200 인치.
        final long totalWidth = 42520L;
        long colWidth = totalWidth / cols;
        final long rowHeight = 1500L;

        table.createSZ();
        table.sz().width(totalWidth);
        table.sz().height(rowHeight * rows.size());

        table.createPos();
        table.pos().treatAsChar(true);

        table.createOutMargin();
        table.outMargin().left(0L);
        table.outMargin().right(0L);
        table.outMargin().top(0L);
        table.outMargin().bottom(0L);

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
                tc.borderFillIDRef("2");

                tc.createCellAddr();
                tc.cellAddr().colAddr((short) c);
                tc.cellAddr().rowAddr((short) r);

                tc.createCellSpan();
                tc.cellSpan().colSpan((short) 1);
                tc.cellSpan().rowSpan((short) 1);

                tc.createCellSz();
                tc.cellSz().width(colWidth);
                tc.cellSz().height(rowHeight);

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
