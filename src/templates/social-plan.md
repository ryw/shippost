Plan a set of distinct, grounded social posts from these meeting notes. Return JSON only.

STYLE AND CONFIDENTIALITY RULES:
{{style}}

AVAILABLE TEXT-ONLY STRATEGIES:
{{strategies}}

SELECTION PREFERENCES:
{{selectionPreferences}}
Higher diversityWeight favors varied categories when the source supports them. If preferThreadFriendly is true, prefer strategies marked threadFriendly. Grounding and distinct claims take priority over format diversity.

MEETING NOTES:
{{transcript}}

Choose up to {{count}} posts. Treat this as a maximum, not a quota: return fewer rather than repeat an argument or invent facts. Choose strategies that match evidence in the notes, not merely different formats. No photo, video, hobby, or personal-story premise unless the source actually supplies the required material. No imagined experiences, demonstrations, endorsements, or visual assets.

Give each post a distinct claim, supporting fact, or actionable lesson. A different hook or format for the same claim is not a distinct angle. Do not repeat the same metaphor across posts. Assign x (280 characters maximum) or linkedin (typically 1000–2000 characters) to each. Use both platforms when suitable. Follow the style guide's privacy rules; evidence is for internal grounding, not permission to publish confidential details.

Return this structure:
{"posts":[{"strategyId":"an ID from the supplied list","angle":"one specific, unique claim","evidence":"brief supporting detail from the notes","platform":"x or linkedin"}]}
