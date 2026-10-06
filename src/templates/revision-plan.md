Identify which existing articles genuinely need refinement based on these new meeting notes. Return JSON only. This is a selection step, not a rewrite.

MEETING NOTES:
{{transcript}}

CANDIDATE ARTICLES (IDs and full content):
{{articles}}

Select an article only if the notes provide a concrete correction, clarification, or sharper formulation of its existing argument. Sharing a broad topic is not sufficient. New arguments belong in new articles, not appended sections. Articles written from these same notes must not be selected. Preserve the article's scope, structure, and length. Never select an article merely to insert confidential information, private business metrics, identifiable customers, or unverified claims.

An empty selection is normal. Do not choose a minimum number or try to use every fact in the notes. Return only IDs from the supplied candidates, each with a brief specific reason:
{"articles":[{"id":"candidate ID","reason":"what existing claim needs correction or clarification and why"}]}
