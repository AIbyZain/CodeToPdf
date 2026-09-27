# Sample assignment for manual testing

Upload everything in `sample-assignment/` (then `dup/question1.css` separately). Expected behaviour:

- question1–5 .html/.css, Q7_HTML/Q7_CSS, question_8.py, Question-9.java, q6_long.* → grouped automatically (Q1–Q9)
- `lab_2.js`, `faq3.txt` → Unassigned with a suggestion; `unknown.html` → Unassigned, no suggestion
- `photo.png` → rejected (unsupported); `fake.txt` → rejected (binary); `empty.css` → skipped (empty)
- `dup/question1.css` → kept as `question1 (2).css` with a warning (different content, same name)
- `q6_long.html` has a very long line 51 → wraps onto `»` rows; long files span several pages
- `Question-9.java` contains `→` → UI warns it will print as a red "?"
- question*.html use tab indentation and "Café “Menu” —" → must print exactly
