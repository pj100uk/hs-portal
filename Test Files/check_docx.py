"""Quick check: extract text from converted .docx files via mammoth."""
import os
import mammoth

FOLDER = r"E:\hs-portal\Test Files"

for fname in sorted(os.listdir(FOLDER)):
    if not fname.lower().endswith(".docx"):
        continue
    path = os.path.join(FOLDER, fname)
    with open(path, "rb") as f:
        result = mammoth.extract_raw_text(f)
    text = result.value.strip()
    print(f"\n{fname}")
    print(f"  Chars : {len(text)}")
    if text:
        print(f"  Preview: {text[:200]!r}")
    else:
        print("  *** EMPTY — text still missing ***")

print("\nDone.")
