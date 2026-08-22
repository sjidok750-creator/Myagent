# 도구를 넓히기

`scripts/java/HwpTool.java`는 흔한 문서에 필요한 만큼만 다룹니다. 라이브러리 자체는 한글 문서의 거의 모든 것을 지원하므로, 필요한 기능은 대체로 "라이브러리에 없어서"가 아니라 "아직 연결하지 않아서" 안 되는 것입니다.

## 목차

- [라이브러리 지도](#라이브러리-지도)
- [API를 찾는 법](#api를-찾는-법)
- [자주 필요한 것들](#자주-필요한-것들)
- [구형 .hwp 다루기](#구형-hwp-다루기)
- [주의할 점](#주의할-점)

## 라이브러리 지도

`kr.dogfoot:hwpxlib` (Maven Central). 의존성이 없어 jar 하나로 돕니다.

```
kr.dogfoot.hwpxlib
├── tool.blankfilemaker.BlankFileMaker   빈 문서 만들기 (여기서 시작)
├── reader.HWPXReader                    .hwpx 읽기
├── writer.HWPXWriter                    .hwpx 쓰기
├── tool.textextractor.TextExtractor     글자만 뽑기
├── tool.finder.*                        문서 안에서 특정 요소 찾기
└── object
    ├── HWPXFile                         문서 전체
    ├── content.header_xml               글자모양·문단모양·스타일 (서식의 원본)
    │   └── refList()
    │       ├── charProperties()         글자모양 목록 (크기·굵기·색)
    │       ├── paraProperties()         문단모양 목록 (정렬·들여쓰기·줄간격)
    │       ├── styles()                 스타일 (바탕글, 개요 1~7 …)
    │       ├── borderFills()            테두리·배경
    │       └── numberings()             자동 번호매기기
    └── content.section_xml              본문
        ├── SectionXMLFile               쪽 하나 (addNewPara)
        └── paragraph
            ├── Para                     문단 (paraPrIDRef, styleIDRef)
            ├── Run                      같은 서식이 이어지는 구간 (charPrIDRef)
            ├── T                        글자
            └── object                   표·그림·글상자
                ├── Table
                ├── Picture
                └── Rectangle …
```

핵심 구조는 **서식을 header에 정의하고 본문에서 번호로 참조**하는 방식입니다. 글자 크기를 바꾸려면 `charProperties()`에 새 항목을 만들고, 그 id를 `Run.charPrIDRef()`에 넣습니다. `HwpTool.prepareCharStyles()`가 그 예입니다.

## API를 찾는 법

문서가 넉넉하지 않으므로 jar를 직접 들여다보는 편이 빠릅니다.

```bash
JAR=~/.cache/hwp-skill/hwpxlib.jar

# 클래스 목록 훑기
unzip -l "$JAR" | grep -i picture | grep -v '\$'

# 어떤 메서드가 있는지
javap -cp "$JAR" kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.object.Table

# 열거형 값 확인
javap -cp "$JAR" kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.VerticalAlign2
```

기존 한글 문서에서 배우는 방법도 좋습니다. 원하는 서식이 든 문서를 한글로 만들어 저장한 뒤 열어보면, 어떤 XML이 필요한지 그대로 보입니다.

```bash
unzip -p 견본.hwpx Contents/section0.xml | python3 -c "import sys,xml.dom.minidom as m; print(m.parseString(sys.stdin.read()).toprettyxml()[:4000])"
unzip -p 견본.hwpx Contents/header.xml | grep -o '<hh:charPr id="[0-9]*"[^>]*'
```

## 자주 필요한 것들

### 가운데 정렬, 들여쓰기

`paraProperties()`에 새 ParaPr을 만들고 `Para.paraPrIDRef()`로 참조합니다. 정렬은 `ParaPr.align().horizontal(HorizontalAlign2.CENTER)`.

빈 문서에는 이미 여러 ParaPr이 들어 있으니(`header.xml`에서 확인), 새로 만들기 전에 쓸 만한 것이 있는지 먼저 보세요.

### 머리말 / 꼬리말 / 쪽번호

머리말은 문단 안의 컨트롤입니다. `Run.addNewHeader()` 계열을 찾아보세요. 쪽번호는 `AutoNum` 컨트롤입니다.

### 그림 넣기

두 곳을 손봐야 합니다.
1. 그림 파일을 문서 안에 넣고 `Contents/content.hpf`의 manifest에 등록
2. 본문에 `Picture` 객체를 만들고 그 항목을 참조

`BinData` 관련 클래스와 `ManifestXMLFile`을 함께 보세요. 표보다 손이 많이 갑니다.

### 셀 병합

`Tc.cellSpan().colSpan()` / `rowSpan()`에 1보다 큰 값을 줍니다. 이때 **병합되어 사라지는 칸의 `Tc`는 아예 만들지 않아야** 합니다. 만들어 두면 한글이 표를 그리다 어긋납니다.

### 여러 쪽

`HWPXFile.sectionXMLFileList()`에 SectionXMLFile을 더합니다. 다만 쪽이 넘치면 한글이 알아서 나누므로, 대개는 쪽나눔 컨트롤 하나면 충분합니다.

## 구형 .hwp 다루기

`.hwp`는 이진 형식이라 다른 라이브러리를 씁니다.

```
kr.dogfoot:hwplib:1.1.9
https://repo1.maven.org/maven2/kr/dogfoot/hwplib/1.1.9/hwplib-1.1.9.jar
```

같은 사람이 만들어 구조가 비슷합니다. 읽기는 안정적입니다.

```java
HWPFile file = HWPReader.fromFile("문서.hwp");
String text = TextExtractor.extract(file, TextExtractMethod.InsertControlTextBetweenParagraphText);
```

`.hwp` 쓰기도 지원하지만 `.hwpx`보다 까다롭습니다. 한글 2014 이후 버전은 `.hwpx`를 문제없이 열기 때문에, 사용자가 굳이 요구하지 않는다면 `.hwpx`로 내는 편이 낫습니다.

## 주의할 점

**로케일.** JVM은 `sun.jnu.encoding`을 아주 이른 시점에 읽습니다. `-D` 플래그로는 늦어서, 로케일이 UTF-8이 아니면 한글 파일명이 깨집니다. `hwp.sh`가 `LC_ALL=C.UTF-8`을 미리 잡아 주므로 자바를 직접 부르지 마세요.

**단위.** 길이는 1/7200인치(HWPUNIT)입니다. 글자 크기만 1/100pt입니다. A4 본문 폭은 대략 42,520 HWPUNIT입니다.

**필수 속성.** 표는 `cellAddr`·`cellSpan`·`cellSz`가 모두 있어야 합니다. 하나라도 빠지면 파일은 열리지만 표가 무너져 보입니다. 새 요소를 붙일 때는 만들자마자 한글에서 열어보는 편이 빠릅니다.

**검증 방법.** 만든 파일을 `hwp.sh read`로 다시 읽어보면 내용이 살아있는지 알 수 있습니다. 다만 서식이 제대로인지는 알 수 없으니, 서식을 건드렸다면 사용자에게 파일을 보내 한글에서 확인받으세요.
