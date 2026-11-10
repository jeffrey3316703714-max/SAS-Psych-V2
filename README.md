# SAS Psychology IA — Online Framing Experiment

A ready-to-deploy, anonymous questionnaire website with a password-protected researcher dashboard. Based on the provided **Psych experiment.pdf**, with **one requested update** to the first main scenario.

## What is included

- Participant questionnaire: `/` (consent → Scenario 1 → 5 distraction questions → Scenario 2 → debrief).
- Local questionnaire preview: `/preview.html` (**not connected to the database; responses are not saved**).
- Self-contained preview: `sas_experiment_preview.html` at the project root; opens without a web server or database. This is a demo only and does not store live responses.
- Researcher dashboard: `/researcher.html` (researcher password, counts, paired results, individual anonymous records, CSV export).
- Supabase SQL table and functions: `database/schema.sql`.
- Netlify serverless backend: `netlify/functions/api.mjs`.
- Main questionnaire material: `public/content.js`.

**Questionnaires:**

| Version | First situation | Then | Second situation |
| --- | --- | --- | --- |
| A | Field trip, positive frame | Five distraction questions | Concert, negative frame |
| B | Field trip, negative frame | Five distraction questions | Concert, positive frame |

Each student sees both framing conditions and only one frame of each scenario. The interface does not reveal the framing labels to participants. Each answer saves one at a time; participants can't move backward in the questionnaire.

**Assignment:** The server uses a Postgres transaction-level advisory lock to choose Version A or B at random when counts tie, and assigns the next participant to the less-populated version otherwise. For each **new assignment**, the server gives priority to the less-populated group; when counts tie it randomly selects A or B. Withdrawals or expired sessions may cause temporary imbalances. Completing the study is voluntary; the number of **completed** responses may still differ if students leave early. Incomplete sessions expire after two hours and are removed when the next new session begins.

### Important change to the supplied experiment

The PDF's later field-trip draft used 500 students, a guaranteed 330 attending / 170 missing, and probabilities 1/3 and 2/3. This made Plan A substantially better in expected value than Plan B. At your request, it now uses:

- **Field trip:** 400 students; **positive** guaranteed 100 attend, **negative** guaranteed 300 miss; risky option **1/4** chance everyone attends / nobody misses, and **3/4** chance nobody attends / everyone misses.
- **Concert:** unchanged from the newer PDF: 600 students; **positive** guaranteed 200 attend, **negative** guaranteed 400 miss; risky option **1/3** versus **2/3**.

Within each situation, the framing versions and risk options have equivalent expected outcomes. **However, the probability structures differ between the two situations (1/4 versus 1/3).** This is a possible confound and should be discussed in your methods/limitations. You may want to review it with your teacher before starting real data collection.

The five distraction scenarios come from pages 5–7 of the PDF: cafeteria, city council, village agriculture, university business program, and restaurant improvement.

## Deployment (GitHub + Netlify + Supabase)

You need accounts for **Supabase** (database) and **Netlify** (hosting). The website is not live or storing real answers until these steps are completed.

1. **Create a Supabase project** at https://supabase.com. Select the project's region and privacy settings according to your school's requirements.
2. Open **SQL Editor** → **New query**, paste the entire `database/schema.sql`, and run it. This creates the study table and the transactional balancing / saving functions.
3. In Supabase, open **Project settings → API** (the label may vary) and copy the **Project URL** and the **service-role key** (a secret, server-only credential). Never commit the key in files or expose it in browser JavaScript.
4. Upload the entire project folder (not just the `public` folder) to a **private GitHub repository**. Create a new Netlify site using **Import from Git** and connect the repository. The root `netlify.toml` provides the publish directory and serverless function location. Alternatively deploy the full project with Netlify CLI; a static drag-and-drop upload alone is not enough for the backend.
5. In **Netlify → Site configuration → Environment variables**, set:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Supabase project URL starting `https://` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret key, **server only** |
   | `RESEARCHER_PASSWORD` | A unique strong password, shared privately with the research team |
   | `RESEARCHER_SESSION_SECRET` | A random long secret, at least 32 bytes (e.g. 64 hexadecimal characters) |

   Generate a session secret locally, for example: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

6. **Deploy/redeploy** the site after setting environment variables. Your participant URL is `https://YOUR-SITE.netlify.app/`. Your researcher dashboard is `https://YOUR-SITE.netlify.app/researcher.html`.
7. Before asking classmates to participate, test with at least two devices or browsers. Complete a few test submissions, confirm the dashboard updates, and **reset the test data** before collecting official data. To reset, in Supabase SQL Editor run `truncate table public.study_sessions;` (irreversible; only before the real study).

**Important:** Configure and test the Supabase database and Netlify functions before using the study. This package has been locally inspected and code-tested, but no live database or account has been connected in this chat.

## Trying the interface before deployment

The easiest way is to open the included **`sas_experiment_preview.html`** file directly in a browser. It contains the entire questionnaire interface and requires no setup. Alternatively, from the project folder, start a local static web server:

```bash
python -m http.server 8000 --directory public
```

Open `http://localhost:8000/preview.html`. Preview sessions run only in browser `sessionStorage`, randomly choose a demo version, and do not save or collect actual responses. A direct visit to `http://localhost:8000/` will require the Netlify backend. Do not mistake a preview submission for saved data.

## Research dashboard / response interpretation

- Login at `/researcher.html` using `RESEARCHER_PASSWORD`.
- View assigned Version A / Version B counts, completed response counts, framing outcomes and individual *anonymous* responses.
- Download a CSV including anonymous UUID, framing labels, all seven choices and completion times.
- For the main scenarios, **Plan A = certain**; **Plan B = risky**.
- Across both conditions, a `positive_choice = A` is a risk-averse/certain choice and a `negative_choice = B` is a risk-seeking/risky choice.
- The five distraction answers are stored but are not included in framing percentages.

## Ethical / data handling notes

- The form requests no names, school emails, student IDs, or signatures. A random UUID links a student's paired responses across the seven pages.
- Student consent is recorded through an opt-in checkbox; the researcher must obtain **school approval** and any guardian consent/assent required for research with high-school students.
- Participants may stop and request deletion of their current session. The stored random session ID lets the same device request deletion, including after completion, as long as that browser still has the session token.
- A student can only access their own session by possessing its unpredictable UUID. The back-end service-role key is never sent to the browser; database tables have row-level security and no direct anonymous table grants.
- Researcher data is available only to someone with the correct password and signed, HttpOnly, Secure, SameSite=Strict researcher cookie. Use a **strong, private password**, protect hosting/database accounts with MFA, and never distribute `/researcher.html` as a participant link.
- In Netlify and Supabase, normal infrastructure request logs may still contain technical metadata such as IP addresses. Do not promise total network anonymity; the *questionnaire data collected* is anonymous to the researchers.
- Agree on data retention and deletion with your supervising teacher. After analysis, export results securely and delete cloud data if required by school policy.
- Prevent students from conferring during advisory; do not tell them the framing hypothesis before completing the questionnaire. The debrief at the end explains the purpose.
- The five long filler passages extend completion time; the consent page estimates about 10 minutes, but confirm using a pilot.

## Testing

Run `npm test` (built-in Node test runner, Node 20+). This checks the changed scenario numbers, all five distraction questions, key API validation and the researcher authentication pathway. The balanced assignment logic requires a configured live Supabase project to test end-to-end.

## Limitations worth noting in the IA

- The field-trip and concert scenarios differ in topic and now also in probability structure (1/4 vs 1/3), so scenario differences may influence choices.
- There are two framing assignment versions, **not** four order-balanced versions: all participants see the field trip first and the concert second. The framing allocation is counterbalanced across the two scenarios, but scenario order is fixed.
- Five distraction questions and separate pages may reduce demand characteristics, but do not eliminate them; ask pilot participants what they think was being tested.
- Balanced assignment does not guarantee equal **completed** sample sizes.

## File structure

```text
public/
  index.html         Participant entry
  preview.html       Local participant demonstration (no data collection)
  app.js             Participant questionnaire flow
  content.js         Your study's scenarios and five distractions
  researcher.html    Research dashboard entry
  researcher.js      Dashboard charts, table and CSV export
  styles.css         Responsive website styles
database/schema.sql  Supabase schema and atomic assignment functions
netlify/functions/api.mjs  Server-side API and signed researcher login
netlify.toml         Deployment and security headers
package.json         Node commands
tests/experiment.test.mjs
```
