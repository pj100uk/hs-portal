import os
import win32com.client

FOLDER = r"E:\hs-portal\Test Files"

word = win32com.client.Dispatch("Word.Application")
word.Visible = False

for fname in sorted(os.listdir(FOLDER)):
    if not fname.lower().endswith(".doc"):
        continue
    src = os.path.join(FOLDER, fname)
    print(f"\n{fname}")
    doc = word.Documents.Open(src)

    body = "".join(p.Range.Text for p in doc.Paragraphs).strip()

    textbox = ""
    for shape in doc.Shapes:
        try:
            if shape.TextFrame.HasText:
                textbox += shape.TextFrame.TextRange.Text
        except Exception:
            pass
    textbox = textbox.strip()

    print(f"  Body text chars    : {len(body)}")
    print(f"  Text-box chars     : {len(textbox)}")
    if body:
        print(f"  Body preview       : {body[:120]!r}")
    if textbox:
        print(f"  Text-box preview   : {textbox[:120]!r}")

    doc.Close(False)

word.Quit()
print("\nDone.")
