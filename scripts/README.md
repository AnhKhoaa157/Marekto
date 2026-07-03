# Backend Postman Contract

`Marekto.postman_collection.json` is the canonical Postman contract for the
Marekto backend.

For every backend logic change:

1. Run `npm run postman:check` before editing.
2. Inspect the affected Postman request and compare its method, URL,
   authentication, headers, query parameters, body, response contract,
   variables, and tests with the implementation.
3. Update the collection whenever public behavior changes.
4. If the change is internal only, still review the collection and state in the
   handoff that no Postman update was required.
5. Run `npm run postman:check` after editing.

The checker detects missing, stale, and duplicate route methods. Payload and
response semantics still require deliberate review.

Never commit real JWTs, OTPs, passwords, cron secrets, SMTP credentials,
Gemini keys, database credentials, or production tenant data.
