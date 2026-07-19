# llmrpg Design Review

## Executive summary

llmrpg has an unusually strong technical blueprint for an agent-driven game. Its best decisions are:

- **“LLMs propose; the engine disposes.”** The authoritative symbolic game state validates every mutation.
- **Bottom-up quests from genuine NPC agendas.** Quests can alter actual plans, relationships, production, and future behavior.
- **Split-speed cognition and simulation level of detail.** Reflex, conversation, and deliberation are separated, with cheaper simulation for distant NPCs.
- **A Director that manages drama without owning NPC minds.**
- **Persistent chronicles and legends across playthroughs.**
- **Evaluation and cost controls designed from the beginning.**

The main weakness is not the agent architecture. It is the absence of an equally detailed **player-experience architecture**.

The design explains how NPCs remember, plan, gossip, and generate quests, but says much less about what the player repeatedly notices, decides, risks, learns, masters, and changes. Walking, chatting, and accepting generated quests are not yet a distinctive game loop.

The product promise should be sharpened from “infinite content” toward:

> **Form attachments, change people’s lives, and return to evidence that they remember.**

Persistent, legible, personal consequence is a stronger differentiator than content volume.

## What is especially strong

### Authoritative world state

The rule that LLMs may propose actions but cannot directly mutate the world is the correct foundation for:

- Persistent consequences
- Reliable quest predicates
- Debugging and replay
- Security boundaries
- NPC knowledge limits
- Meaningful evaluation

This is the most important architectural decision in the design.

### Agenda-grounded quests

Quests originating from real NPC needs are substantially more compelling than standalone generated assignments. If helping the blacksmith changes her output, plans, gratitude, and social position, the quest becomes part of the simulation rather than text layered over it.

This is a genuine differentiator and should be demonstrated as early as possible.

### Split-speed cognition

Separating reflexive behavior, interactive conversation, and slow deliberation is well aligned with both latency and cost constraints. The focal/warm/cold simulation model also avoids the common mistake of giving every background character an expensive inner monologue.

### Director boundaries

Treating the Director as a drama manager rather than a puppeteer is the right intent. Late binding, forward replanning after player choices, and treating failure as content are all sound anti-railroading principles.

### Persistent legend pipeline

The event log → chronicle → saga → legend progression gives the project a memorable long-term identity. Prior characters returning as songs, statues, distorted stories, ghosts, or disputed historical figures could become one of the strongest parts of the experience.

### Evaluation discipline

The micro/meso/macro evaluation structure is unusually serious for an AI-game proposal. State-verifiable predicates, simulated players, long-running “aquarium” simulations, and explicit cost and latency metrics provide a strong foundation.

## The central design gap: making simulation playable

A simulated society is not automatically a good game. The player must be able to:

1. Notice meaningful changes.
2. Understand enough causality to make informed choices.
3. Manipulate the social and physical systems.
4. Anticipate future consequences.
5. Form attachments to specific people.
6. Recall and share what happened.

Much of the current design makes NPC autonomy real in the database but does not yet make it sufficiently visible or actionable.

For example, the fact that an NPC changed goals is only valuable if the player can observe consequences through behavior, schedules, dialogue, the environment, rumors, or the journal. Otherwise, a sophisticated simulation may feel indistinguishable from random generated prose.

## Important tensions to resolve

### NPC autonomy versus interestingness

The vision says NPCs are motivated to create memorable stories for the player. That risks making them feel like performers rather than inhabitants.

NPCs should pursue diegetic goals: safety, status, love, revenge, duty, wealth, or belief. The Director should curate which collisions become visible and how they are paced. Interestingness should primarily be a Director concern, not an NPC drive.

### Director guidance versus puppeteering

A scene instruction such as “do not reveal the ledger yet” can conflict with an NPC who has strong reasons to reveal it.

Director briefs should preferably:

- Expose relevant dramatic context
- Suggest pressures or opportunities
- Control scene selection and timing
- Avoid directly overriding a character’s incentives

If withholding is necessary, it should have an in-world reason the NPC can own.

### Expert-DM promise versus minimal player systems

The expert-DM comparison implies:

- Responsive social play
- Exploration and discovery
- Tactical or strategic stakes
- Character identity and progression
- Pacing, escalation, and recovery

The current R1 design is strongest on dialogue and NPC cognition but thin on player progression, exploration rewards, social mechanics, and non-dialogue problem solving.

If combat intentionally remains shallow, the game needs sufficiently rich **social and investigative mechanics** to carry the experience.

### Infinite quests versus attention

Infinite quests can reduce rather than increase meaning. The player needs:

- A manageable number of active threads
- Reasons to ignore or refuse requests
- Deadlines and competing obligations
- Quest transformation and expiration
- A distinction between ambient opportunities and major commitments

The Director should manage player attention, not merely quest admission.

### Tolkienesque setting versus anything-goes content

The setting can support surreal intrusions, but tonal incoherence may make generated content feel arbitrary. Tone configuration should be a prominent player-facing choice covering more than content safety:

- Genre consistency
- Seriousness versus comedy
- Frequency of anomalous elements
- Narrative brutality
- Romance and intimacy
- Director volatility

## Low-hanging fruit with disproportionate impact

### 1. Consequence receipts

After a meaningful action, provide a compact “Because you…” update showing consequences such as:

- An NPC changed plans
- A relationship shifted
- A rumor began spreading
- A shop or service changed
- A faction clock advanced
- A future appointment was created

These should remain grounded in event IDs and actual state changes. They make the living world perceptible without revealing every hidden variable.

### 2. Promises, favors, and appointments

Treat commitments as first-class gameplay:

- “Meet me at the mill at dusk.”
- “I will keep your secret.”
- “You owe me safe passage.”
- “If you enter my district again, I will have you arrested.”

Promises create anticipation and provide clear tests of trust, betrayal, memory, and character consistency without requiring a formal quest.

### 3. Rumor provenance

Beliefs should include:

- Proposition or claim
- Source
- Confidence
- First-hand versus reported status
- Observation and transmission times
- Distortion history
- Related entities and events

This enables useful dialogue such as “Who told you?”, supports lies and misremembering, and turns the knowledge boundary into investigative gameplay.

### 4. Visible NPC activity

NPC autonomy should often be legible without opening a dialogue window:

- Short contextual barks
- Visible destinations
- Changed routines
- Empty chairs or closed shops
- Scars and altered equipment
- Gifts displayed in homes
- Memorials and graffiti
- NPCs meeting, arguing, or avoiding one another

### 5. Hybrid dialogue

Keep free-text conversation, but expose contextual semantic actions such as:

- Ask
- Accuse
- Bargain
- Promise
- Lie
- Comfort
- Threaten
- Reveal
- Refuse
- Leave

This improves discoverability and gives the rules engine a reliable intent signal. It also reduces reliance on prompt phrasing as the primary social skill.

### 6. Conversation discipline

LLM dialogue tends toward verbosity and endless availability. Conversations should track:

- Topic stack
- Unanswered questions
- Conversational goals
- Patience
- Rapport
- Promised disclosures
- Interruptions
- Exit conditions

NPCs should be able to refuse, become distracted, end a conversation, or ask the player to return later.

### 7. Director personas

Separate pacing policy from difficulty and prose tone. Example Director presets:

- Measured escalation
- Long recovery periods
- Volatile and surprising
- Tragic
- Comic
- Low intervention

This is a relatively inexpensive replayability feature and gives players control over the kind of campaign they want.

### 8. Shareable chronicles

Generate concise, event-grounded session recaps and character cards containing:

- Important causal beats
- Memorable quotations
- Changed relationships
- Unresolved promises
- New titles, scars, and possessions

The Nemesis system demonstrated that personal procedural stories become more valuable when players can recall and share them.

## Mechanics worth adding to the formulation

### Social practices

Recurring social situations should have reusable structures:

- Greeting
- Hosting
- Bargaining
- Testimony
- Mourning
- Courtship
- Debate
- Ritual
- Hospitality

A social practice defines roles, entry and exit conditions, expected acts, taboos, and available affordances. It suggests behavior without controlling the agents.

This layer belongs between reflex behavior and unconstrained LLM conversation.

### Story sifters

A living simulation produces many routine events and relatively few meaningful stories. Deterministic, authorable story recognizers can detect patterns such as:

- Betrayal
- Reciprocated kindness
- Escalating rivalry
- Violated hospitality
- A promise kept at great cost
- A secret passing through enemies

To support this, events should carry causal metadata such as:

- `causedBy`
- `enabledBy`
- `frustratesGoal`
- `witnessedBy`
- Narrative tags

The LLM can label or narrate recognized patterns rather than reconstructing causality from prose.

### Visible agenda and threat clocks

Major NPC and faction plans should have observable progress. Some milestones can appear through rumors, environmental changes, or journal updates.

This makes “the world does not wait” understandable and allows informed decisions between competing crises.

### Typed storylet roles

Storylets should define explicit role slots such as:

- Petitioner
- Granter
- Rival
- Witness
- Confidant
- Betrayer

Characters can be scored for those roles from traits, goals, history, and relationships. This makes late binding computationally explicit and testable rather than solely an LLM instruction.

### Player-authored beliefs and vows

The current design gives NPC agendas a strong role in content generation but leaves the player comparatively reactive.

Character creation could let the player state beliefs or vows such as:

- “No child should pay for a parent’s crime.”
- “I will restore my family’s name.”
- “Magic must remain under royal control.”

The Director may challenge these commitments but should not dictate their resolution.

Campaigns should also contain unresolved **stakes questions** whose answers cannot be preselected by the Weaver.

### Success with cost

Quest objectives should support more than success, failure, or soft failure. “Success with cost” should be first-class:

- Achieve the goal but incur debt
- Save one person while losing another opportunity
- Learn the truth but expose the source
- Win the fight but advance an enemy faction’s plan

This is often where tabletop stories become most memorable.

## Proposed implementation notes

The repository is currently in the design phase; there is no game implementation yet. These observations therefore concern the proposed architecture.

### Build the game before extracting the framework

The goal of a generic reusable NPC-society framework may compete with proving the game.

Maintain clear internal boundaries, but extract a reusable framework only after the Milltown implementation reveals which abstractions are genuinely stable.

### Use a focused vertical slice

The first meaningful experience should be:

1. Meet a small interconnected cast.
2. Discover a social conflict.
3. Intervene through conversation or another world action.
4. Leave or advance time.
5. Return and observe consequences through behavior and the environment.

This tests the actual product promise better than a generic chat milestone.

### Introduce a minimal Director earlier

Phase 3 currently targets endless quests before Phase 4 introduces the Director. Quest quality cannot be evaluated independently of pacing, selection, and player attention.

Before the full quest generator, introduce:

- A deterministic tension state machine
- A quest/thread load cap
- A few authored storylets
- Recovery periods
- One visible antagonist or faction clock

### Prefer structured storylet triggers

Calling an LLM to evaluate natural-language storylet triggers on every narrative tick is costly, difficult to reproduce, and hard to debug.

Prefer:

1. Author-friendly trigger definitions
2. Compilation into structured eligibility predicates
3. Deterministic cooldown and role checks
4. Inspectable scoring
5. LLM ranking only for ambiguous finalists
6. LLM elaboration after selection

### Use bounded solvability certificates

Proving general quest reachability in a changing open world is not realistic.

Require the quest generator to emit one or more witness plans. Validate those plans within a bounded planning horizon and explicitly represent assumptions, alternative paths, and transformation conditions.

### Use hybrid memory retrieval

Semantic similarity alone is insufficient for episodic memory. Retrieval should combine:

- Entity and subject links
- Time windows
- Causal links
- Memory type
- Source and confidence
- Full-text search
- Semantic similarity
- Current goals and scene context

### Harden the SkillShop boundary

Cross-service execution should include:

- Idempotency keys
- Durable job/outbox records
- Retry semantics
- Cancellation
- Prompt, model, and agent version audit data
- Authorization bound to the acting entity and tool

Every NPC execution should explicitly pass the acting NPC, cognition tier, scene, and agent role. Existing service headers do not by themselves establish NPC-versus-Director identity.

### Treat the presentation boundary as asynchronous

The proposed “synchronous-looking over an async boundary” can hide stale state and failure.

Snapshots and deltas should have explicit world revisions. The client should render acknowledged revisions and handle reconnect, replay, cancellation, and out-of-order updates deliberately.

## Roadmap recommendations

### Preserve

- Phase 0 service round trip
- Handcrafted Milltown
- Focal and warm NPC tiers before cold simulation
- Agenda-grounded quest proof
- Evaluation alongside implementation
- Worldgen and scale only after the small-town experience works

### Adjust

1. Move a minimal deterministic Director and authored storylets into the early quest work.
2. Add explicit player-facing social, discovery, and consequence loops before scaling NPC count.
3. Prototype promise tracking and rumor provenance during NPC cognition work.
4. Treat the journal as a core gameplay surface, not a reporting afterthought.
5. Prove one persistent, visibly changed relationship before building infinite quests.
6. Defer reusable-framework extraction until after the first successful vertical slice.

## Evaluation gaps

Believability and consistency are means, not the final product outcome. Add human-facing measures:

- Attachment to named NPCs
- Recall after a session
- Perceived consequence
- Decision meaningfulness
- Surprise without confusion
- World-state comprehension
- Conversation abandonment rate
- Time to first memorable event
- Ability to explain why an NPC acted
- Ability to predict one likely future consequence

Include architectural baselines:

- No-LLM NPCs
- One global actor for all NPCs
- Authored storylets only
- Memory without reflection
- Dialogue without visible consequence receipts

Without these baselines, the project may demonstrate sophisticated agent behavior without proving that the expensive architecture improves play.

## Recommended first proof

Before worldgen, campaigns, legends, or hundreds of NPCs, run this test:

> After 60–90 minutes with 8–10 Milltown NPCs, can a player name three people, explain what each wants, recount one changed relationship, and point to a visible consequence that happened because of their choice?

If yes, the architecture is producing the intended experience.

If no, adding more autonomous agents and more generated quests is likely to amplify noise rather than solve the product problem.

## Additional sources of inspiration

### Prom Week / Comme il Faut

- [Prom Week: Social Physics as Gameplay](http://www.ben-samuel.com/wp-content/uploads/2015/09/FDG-2011-Prom-Week-Social-Physics-as-Gameplay.pdf)

Models social exchanges, status, cultural rules, character history, and volition as playable “social physics.” Relationships create and remove actionable affordances rather than merely changing dialogue tone.

### Versu

- [Versu—A Simulationist Storytelling System](https://doi.org/10.1109/tciaig.2013.2287297)

Uses role-based social practices to coordinate autonomous agents without directly controlling them.

### Talk of the Town / Bad News

- [Toward Characters Who Observe, Tell, Misremember, and Lie](https://doi.org/10.1609/aiide.v11i3.12825)
- [Simulating Character Knowledge Phenomena in Talk of the Town](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter37_Simulating_Character_Knowledge_Phenomena_in_Talk_of_the_Town.pdf)

Directly relevant to subjective knowledge, gossip propagation, provenance, forgetting, misremembering, and lying in a simulated town.

### Story sifting

- [Authoring for Story Sifters](https://mkremins.github.io/publications/AuthoringSifters_TAP.pdf)
- [Felt: A Simple Story Sifter](https://mkremins.github.io/publications/Felt_SimpleStorySifter.pdf)

Addresses the problem of recognizing meaningful stories inside a noisy simulation.

### Façade

- [Structuring Content in the Façade Interactive Drama Architecture](https://eis.ucsc.edu/papers/MateasSternAIIDE05.pdf)

Foundational precedent for combining autonomous character behavior with global dramatic beat sequencing. It is also a warning about authoring cost and unconstrained language.

### Left 4 Dead

- [The AI Systems of Left 4 Dead](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)

Demonstrates adaptive dramatic pacing with explicit build, peak, fade, and relaxation phases. It also separates pacing from difficulty.

### RimWorld

- [About RimWorld](https://rimworldwiki.com/wiki/About_RimWorld)

Shows how selectable storyteller policies create distinct pacing styles while treating failure and disaster as valid story outcomes.

### Wildermyth

- [Wildermyth](https://www.wildermyth.com/)
- [Wildermyth Event Design Philosophy](https://www.wildermyth.com/wiki/Event_design_philosophy)

Relationships, aging, transformation, sacrifice, and recurring legacy characters make procedural history concrete and emotionally legible. Its typed event-role casting is especially relevant to storylets.

### Shadow of Mordor’s Nemesis system

- [Designing Shadow of Mordor’s Nemesis System](https://www.gamedeveloper.com/design/designing-i-shadow-of-mordor-i-s-nemesis-system)
- [Shadow of Mordor Postmortem](https://www.gamedeveloper.com/audio/postmortem-monolith-productions-i-middle-earth-shadow-of-mordor-i-)

Shows that procedural NPC memory becomes emotionally effective through repeated encounters, hierarchy, scars, rank changes, callbacks, and visible mechanical evolution.

### Shadows of Doubt

- [Shadows of Doubt](https://fireshinegames.co.uk/games/shadows-of-doubt/)

Demonstrates how NPC routines become gameplay when the player can tail people, inspect records, connect evidence, and exploit causal traces.

### Caves of Qud

- [Generation of Mythic Biographies in Caves of Qud](https://freeholdgames.com/papers/Generation_of_Mythic_Biographies_in_CavesofQud.pdf)

Generated history is encountered through shrines, engravings, relics, factions, and discovery order. It also demonstrates constrained ex-post rationalization for ancient history.

### Failbetter’s quality-based narrative

- [StoryNexus and Quality-Based Narrative](https://www.failbettergames.com/news/storynexus-is-live)

Shows how explicit world qualities gate storylets and keep large modular narratives tractable.

### Blades in the Dark and Dungeon World

- [Blades in the Dark Progress Clocks](https://bladesinthedark.com/progress-clocks)
- [Dungeon World Fronts](https://www.dungeonworldsrd.com/gamemastering/fronts/)

Provide simple, legible models for advancing threats, faction plans, warning signs, and impending consequences.

### Burning Wheel, Apocalypse World, and Hillfolk

- [Burning Wheel Gold: Hub and Spokes](https://www.wargamevault.com/product/98542/Burning-Wheel-Gold-Hub-and-Spokes)
- [Apocalypse World Principles and Threats](http://apocalypse-world.com/AW2ndEdThreatsPreview.pdf)
- [DramaSystem SRD](https://pelgranepress.com/2013/09/19/dramasystem-srd/)

These tabletop systems offer useful models for player-authored beliefs, preparing open questions rather than outcomes, and structuring dramatic scenes around requested emotional concessions.

## Final assessment

llmrpg is betting on the right foundations:

- Validated actions
- Agenda-grounded quests
- Memory and gossip
- Bounded narrative direction
- Persistent consequences
- Evaluation and cost controls

The project has under-specified how those systems become a game the player can understand and influence.

The highest-leverage next design work is therefore not another agent subsystem. It is defining:

1. The minute-to-minute player loop
2. Social and investigative mechanics
3. Consequence visibility
4. Player identity and commitments
5. Conversation structure
6. The Milltown vertical-slice acceptance test

If those are resolved, the proposed architecture is capable of supporting a distinctive and compelling experience.
