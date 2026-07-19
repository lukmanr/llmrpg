# llmrpg Design Document

An LLM-powered RPG built around societies of autonomous NPC agents. This document specifies the architecture, subsystems, data model, and implementation roadmap. It contains no implementation code; it is the blueprint from which implementation issues are cut.

Companion documents:

- [NPC Agent Literature Review](../research/NPC_AGENT_LITERATURE.md) — the published research and game-design precedents this design draws on.
- [Design Review](../../tasks/LLMRPG_DESIGN_REVIEW.md) — external review whose recommendations are incorporated in this revision (v2).

---

## 1. Vision

llmrpg replicates the experience of playing D&D with an expert dungeon master — one who combines great storytelling with creative tactical and side-quest twists — in an open game world populated by long-running agentic NPCs. NPCs live in the world as autonomous beings with their own agendas, motivations, goals, and aspirations.

The product promise, stated as what the player gets:

> **Form attachments, change people's lives, and return to evidence that they remember.**

Persistent, legible, personal consequence is the differentiator — not content volume. "Infinite sidequests" matter because each one is grounded in a real person's real agenda and leaves real marks, not because there are infinitely many of them.

**Division of dramatic labor** (a rule, not a vibe): NPCs pursue *diegetic* goals only — safety, status, love, revenge, duty, wealth, belief. No NPC has "be interesting" or "entertain the player" as a drive; that would make them performers rather than inhabitants. *Interestingness is the Director's concern*: the Director curates which goal collisions become visible to the player and how they are paced. The system as a whole is engineered to produce memorable stories; no individual character is.

Setting: **Tolkienesque fantasy, anything-goes plot elements.** The thieves' guild leader may be a zombie controlled by an alien brain in a vat in low earth orbit. Tone is a world-configuration choice (§8.6), not an engine constraint.

Three signature experiences:

1. **Infinite sidequests** — procedurally generated backstories paired with choose-your-own-adventure dynamics; NPCs react and evolve with the storyline rather than dispensing static quest text.
2. **Campaigns** — individual adventures strung into larger story arcs with foreshadowing, escalation, and payoff.
3. **A living, remembering world** (Dwarf Fortress inspiration) — generated lore, myth, and legend; persistent worlds across playthroughs where the player's previous lives are memorialized in new legends.

## 2. Goals and Non-Goals

### Goals

- **G1**: Prove the game first: a small, dense, playable experience (the Milltown vertical slice, §7.9) that demonstrates the product promise. A generic reusable NPC-society framework is a long-term goal; we maintain clean internal module boundaries throughout, but **framework extraction is deferred** until the vertical slice reveals which abstractions are genuinely stable.
- **G2**: Engine independence via an internal abstraction layer; first target is a browser-based 2D roguelike UI.
- **G3**: SkillShop (as a git submodule, run in service mode) provides all LLM orchestration, agent execution, streaming, and session management.
- **G4**: NPCs are the product. Graphics are deliberately minimal in R1 so effort concentrates on agent quality — which means **social and investigative mechanics must carry the game** (§7).
- **G5**: Built-in evaluation: NPC believability, quest quality, world liveliness, *and player-experience outcomes* are measured continuously, not vibes-checked.
- **G6**: Production-ready codebase from the start (real persistence, real cost controls, real error handling).

### Non-Goals (for R1)

- 3D rendering, physics, animation (the abstraction layer anticipates them; R1 does not build them).
- Multiplayer (data model must not preclude it; netcode is out of scope).
- Combat depth competitive with dedicated roguelikes — R1 combat is a simple, serviceable turn-based system that exists to give quests stakes. The depth budget goes to social and investigative play instead.
- Voice, image generation (portrait generation is a stretch goal, not a dependency).

## 3. Architecture Overview

### 3.1 Process topology

Following the SkillShop three-process service model (SKILLSHOP_SERVICE.md):

```
┌──────────────────────────────────────────────────────────────────┐
│                     Game Client (browser, Vite :4001)            │
│   Roguelike renderer · dialogue UI · journal/codex · dev HUD     │
├───────────────────────────────┬──────────────────────────────────┤
│   /api/* (game domain)        │  /api/agent/*, /api/chat/*       │
│            ↓                  │             ↓                    │
│  ┌─────────────────────┐      │   ┌─────────────────────────┐    │
│  │  llmrpg Server      │      │   │  SkillShop Server       │    │
│  │  (:4002)            │◄─────┼───│  (:5173, service mode)  │    │
│  │  world sim kernel   │ tool │   │  LLM orchestration      │    │
│  │  rules engine       │ HTTP │   │  agent execution        │    │
│  │  quest/narrative    │ call-│   │  streaming, sessions    │    │
│  │  NPC scheduler      │ backs│   │  workflow agents        │    │
│  └─────────────────────┘      │   └─────────────────────────┘    │
│            ↓                  │              ↓                   │
│  ┌─────────────────────┐      │   ┌─────────────────────────┐    │
│  │  World DB (SQLite   │      │   │  SkillShop SQLite       │    │
│  │  per world/save +   │      │   │  (agents, chats,        │    │
│  │  shared meta DB)    │      │   │   sessions)             │    │
│  └─────────────────────┘      │   └─────────────────────────┘    │
└───────────────────────────────┴──────────────────────────────────┘
```

- **Game client** (`client/`): React + TypeScript. Renders the world via the Engine Abstraction Layer's browser-roguelike adapter. Proxies agent/chat traffic to SkillShop, everything else to the llmrpg server (specific SkillShop routes first, catch-all `/api` to :4002).
- **llmrpg server** (`server/`): Express + TypeScript. Owns the authoritative world state, the simulation kernel, the rules engine, quest/narrative state, and the NPC scheduler. Registers agents and tools with SkillShop at startup; implements all agent tools as HTTP callback endpoints.
- **SkillShop** (`skill-shop/` submodule): run with `SKILLSHOP_SERVICE_MODE=true`, `VPS_ENABLED=false`, `MCP_ENABLED=false`. Provides agent CRUD/registration, execution (`/api/agent/execute-stream`), workflow agents (sequential, parallel, loop, router, evaluate/optimize, scheduled), sessions, and SSE streaming.

**Division of authority — the load-bearing rule of this design**: *LLMs propose; the engine disposes.* Every world mutation flows through the rules engine as a validated **Action**. Agents can only affect the world through registered tools whose handlers validate against the world DB. This is the "LLM proposes, symbolic engine validates" pattern the literature converges on (Metagent-P, G-KMS, HeRoN).

### 3.2 Hardening the SkillShop boundary

Cross-service agent execution is treated as distributed-systems work, not a function call:

- **Acting-entity identity**: `X-SkillShop-*` headers identify the *user*, not the acting game entity. Every agent execution carries an explicit context block — `{ actingEntityId, cognitionTier, sceneId, agentRole (npc|director|weaver|…) }` — passed through to tool calls, and tool endpoints authorize against it: an NPC-role call may only read its own memory and act as itself; Director tools require the director role. Headers alone never establish NPC-vs-Director identity.
- **Idempotency**: every execution and tool call carries an idempotency key; tool handlers are safe under retry.
- **Durable jobs**: Deliberate-tier work (reflection, replanning, batch gossip) runs through a durable job/outbox table in the world DB with retry semantics and cancellation, so a SkillShop restart or timeout never silently drops an NPC's pending cognition.
- **Version audit**: every LLM call records prompt template version, agent version, and model — required for evaluation comparability and debugging.

### 3.3 Monorepo layout

```
llmrpg/
├── client/            # Browser game client
├── server/            # llmrpg game server
│   ├── engine/        # Simulation kernel, rules engine, action system
│   ├── world/         # World model, worldgen, lore/legends
│   ├── npc/           # Cognitive architecture, scheduler, memory, beliefs
│   ├── narrative/     # Director, quests, campaigns, storylets, clocks,
│   │                  #   sifters, chronicle
│   ├── agents/        # Agent prompt templates + SkillShop registration
│   ├── tools/         # HTTP tool endpoints called by SkillShop
│   └── eval/          # Evaluation harness, simulated players, metrics
├── shared/            # Types/schemas shared client↔server (zod)
├── eal/               # Engine Abstraction Layer: core interfaces + adapters
│   ├── core/          # Engine-agnostic interfaces
│   └── adapters/roguelike-web/   # R1 adapter
├── skill-shop/        # Submodule (service mode)
├── data/              # Static content packs: races, cultures, name banks,
│                      #   quest templates, storylets, practices, tone configs
├── docs/              # design/, research/, technical/
├── scripts/           # dev orchestration (ensure-dev, kill-all, db, eval runs)
└── tasks/             # implementation task tracking
```

## 4. Engine Abstraction Layer (EAL)

The EAL is llmrpg's internal contract with "whatever renders and inputs the game." Game logic, NPC cognition, and narrative systems depend only on EAL core interfaces; adapters implement them for a concrete engine/target.

### 4.1 Core interfaces (specification level)

| Interface | Responsibility |
|---|---|
| `WorldView` | Read-only queries the presentation layer needs: visible entities in a region, tile/terrain data, lighting/visibility (FOV), entity appearance descriptors |
| `Renderer` | Draw a frame from a `WorldView` + camera; purely presentational, holds no game state |
| `InputSource` | Normalized player intents (move, interact, attack, open-inventory, talk, examine), not raw keys — key bindings live in the adapter |
| `Ticker` | Time-step contract between simulation and presentation (turn-based in R1; the interface supports fixed-step real-time later) |
| `AudioSink` | Optional; no-op in R1 |
| `PresentationChannel` | Non-spatial UI surfaces the game logic can address abstractly: dialogue panes, journal, notifications, menus |

Design rules:

- Entity appearance is a **descriptor** (`{ archetype, tags, disposition, … }`); the adapter maps descriptors to glyphs (R1) or meshes (later). Game logic never mentions glyphs or sprites.
- Spatial model is **abstract grid + region graph** in core. A future 3D adapter maps grid cells to navmesh regions; the region graph (rooms, roads, zones) is the level NPCs and the Director reason at, so it survives the engine swap.

### 4.2 The presentation boundary is explicitly asynchronous

The client renders server-authoritative state via a snapshot/delta protocol with **explicit world revisions**:

- Every snapshot and delta is stamped with a monotonic world revision; the client renders only acknowledged revisions.
- Reconnect performs snapshot + replay from the last acknowledged revision; out-of-order deltas are buffered or discarded by revision arithmetic, never applied blindly.
- Player intents are submitted against a revision; the server rejects intents against stale revisions where the divergence matters (the rules engine re-validates regardless).
- In-flight LLM streams (dialogue) are addressable and cancellable so a scene change or disconnect doesn't leave orphaned generation.

### 4.3 R1 adapter: `roguelike-web`

- Canvas/WebGL glyph renderer (evaluate `rot-js` for FOV/pathfinding utilities vs. small bespoke implementations; decision task in Phase 1).
- Classic roguelike presentation: glyph map, message log, side panel (stats, time, location), modal dialogue window for NPC conversations with streaming text (SSE pass-through from SkillShop).
- Turn-based ticker: the world advances when the player acts; background simulation ticks are decoupled (§6.5).

## 5. World Model

### 5.1 Entity model

Entity-Component style records in the world DB (not a full archetype-ECS runtime in R1 — a component-tagged relational model that can be ported to a real ECS later):

- **Entity**: stable UUID, kind (`npc`, `player`, `item`, `location`, `faction`, `creature`, `structure`, …), name, tags.
- **Components** (per-kind, typed, zod-validated): `Position`, `Stats`, `Inventory`, `Persona` (NPC), `Agenda` (NPC), `Relationships`, `FactionMembership`, `QuestGiver`, `Lore`, `Container`, `Portal`, etc.
- **Spatial hierarchy**: World → Region → Locale (town, dungeon level, wilderness cell) → Tile. Locales are the streaming/simulation unit.

### 5.2 World state authority and causal events

- One **SQLite database per world** (a "world" persists across playthroughs; a playthrough is a character-run within a world). A small shared meta DB indexes worlds/saves/settings.
- All mutations flow through the **Action system**: `Action = { actor, verb, targets, params }` → rules engine validates (permissions, physics, resources, reachability) → applies → emits **Events**.
- **Events carry causal metadata from day one**: `{ id, time, verb, actor, targets, causedBy (event/action ids), witnessedBy (entity ids, from perception), narrativeTags }`, extended in Phase 2 with `frustratesGoal` / `advancesGoal` (goal ids) once agendas exist, and `enabledBy` where derivable. Causality is recorded at emission time because it cannot be reliably reconstructed later — and it is the substrate for consequence receipts (§7.2), story sifters (§8.4), the chronicle, and legends.
- The **event log** is append-only per world — simultaneously the NPC perception source, the replay/debug record, and the raw material for lore generation.

### 5.3 Time

- **Game clock** decoupled from wall clock. R1: player-turn-driven in the active locale, with a background scheduler advancing off-screen locales in coarse increments (§6.5).
- Calendar with seasons/years — required for legends ("in the Year of the Broken Crown…") and NPC life-cycles.

## 6. NPC Cognitive Architecture

The heart of the project. Per the literature review, the architecture combines the Generative-Agents memory model with PIANO-style split-speed cognition and strict symbolic validation — plus subjective belief modeling in the tradition of *Talk of the Town*.

### 6.1 NPC anatomy

Every NPC has:

1. **Persona sheet** (authored or generated; immutable core + mutable surface):
   - Core: name, species/culture, backstory summary, personality (trait vector + prose), values, fears, speech style, secrets, true allegiances (the zombie-guild-leader's alien controller lives here).
   - Surface (mutable): current mood, health, wealth tier, public reputation, location, occupation.
2. **Agenda**: hierarchy of drives → goals → plans → next intents.
   - *Drives* (near-permanent, **strictly diegetic**): survive, prosper, protect family, seek the throne, serve the vat-brain. Never "be interesting" (§1).
   - *Goals* (weeks-months of game time): "become guildmaster", "find who killed my brother".
   - *Plans*: ordered steps toward a goal, each step an abstract action with preconditions.
   - *Intents*: the next concrete Action(s) to submit to the rules engine.
3. **Memory and beliefs** (§6.3).
4. **Relationship model**: typed, directional edges to other entities (trust, affection, fear, debt, rivalry; numeric weight + prose annotations). Includes *beliefs about others' goals* — required for social differentiation (Project Sid finding).
5. **Knowledge boundary**: what the NPC believes vs. what is true. NPCs act on beliefs; the gap powers dramatic irony and investigative play (§7.4).

### 6.2 Split-speed cognition (three tiers) and social practices

| Tier | Latency budget | Mechanism | Used for |
|---|---|---|---|
| **Reflex** | ~0 (no LLM) | Rules/behavior trees over agent state | Movement along a planned path, flee-on-low-HP, greetings, routine job actions, combat rounds |
| **Converse** | interactive (streamed) | SkillShop agent execution with persona prompt + retrieved memories + scene context | Dialogue with the player or other NPCs in the focal scene |
| **Deliberate** | seconds–minutes, off-turn | Durable jobs (§3.2) executing SkillShop workflow agents | Reflection, replanning, goal revision, relationship updates, gossip digestion |

A shared **agent state** record (world DB) is the single source each tier reads/writes — the PIANO "shared state + bottleneck" pattern. The Deliberate tier is the only writer of goals/plans; Converse can propose plan changes ("I'll meet you at the mill at dusk") which are committed as *promises* (§7.3) the Deliberate tier reconciles.

**Social practices** (Versu pattern) sit between Reflex and unconstrained Converse: a practice is a reusable structure for a recurring social situation — `{ roles, entry/exit conditions, expected acts, taboos, affordances }` — that *suggests* behavior to participants without controlling them, and tells the dialogue UI which semantic acts (§7.5) are contextually apt. R1 ships **three practices only** (bargaining, hospitality, testimony); the layer generalizes later only if these earn it.

### 6.3 Memory and belief system

Generative-Agents memory adapted to a game, with **provenance-carrying beliefs** as a first-class record type:

- **Memory stream** per NPC: records `{ time, type: observation|thought|belief|promise|reflection, text, subjects[], importance, embedding }`.
- **Beliefs carry provenance** (*Talk of the Town* pattern): `{ proposition, aboutEntities[], source (entity|event), firsthand: boolean, confidence, observedAt, receivedAt, distortionHistory[] }`. Gossip transmits beliefs with source attribution and stochastic distortion appended to `distortionHistory`. This enables "Who told you?" dialogue, lies, misremembering, and investigation (§7.4) — and distortion history at generational range *is* mythologization, feeding legends (§11.3).
- **Perception filter**: NPCs don't observe raw events; a per-NPC filter converts world Events within perception range into observations/beliefs (setting `witnessedBy` and `firsthand`), with LLM-free templated rendering for routine events and importance scoring batched through a cheap model.
- **Hybrid retrieval** — semantic similarity alone is insufficient for episodic memory. Retrieval combines, with tunable weights: entity/subject links, time windows, causal links (via event `causedBy` chains), memory type, source and confidence, full-text search, embedding similarity, recency, importance, and current goal/scene context. The Generative-Agents recency×relevance×importance score is the starting point for the scalar portion (0.5/3/2).
- **Reflection**: importance-accumulator threshold triggers a Deliberate-tier reflection job (SkillShop loop workflow): synthesize salient questions → answer from memories → store reflections. Reflections feed persona drift (mood, relationships, goal weights) within bounds set by the immutable persona core.
- **Forgetting/compaction**: periodic compaction summarizes cold low-importance memories into digest records; originals are archived (event log keeps ground truth).
- **Social memory propagation**: gossip exchanges belief records during co-located social time (mostly simulated statistically off-screen, LLM-rendered only when the player is present). This is how player deeds become reputation and eventually legend.

### 6.4 Conversation discipline

LLM dialogue defaults to verbosity and infinite availability; both are believability and cost bugs. Every Converse-tier scene tracks explicit conversation state:

- **Topic stack** and unanswered questions (both sides).
- **Conversational goals** (what the NPC wants from this exchange, derived from agenda + practice role).
- **Patience and rapport** meters (persona- and relationship-derived), decremented by rudeness, repetition, time pressure.
- **Promised disclosures** ("ask me again when the ledger is found") and **exit conditions**.

NPCs can refuse topics, become distracted, end conversations, or ask the player to return later — enforced by scene state, not by hoping the model does it. Patience exhaustion is a hard stop the engine applies.

### 6.5 The NPC scheduler and simulation LOD

| LOD | Applies to | Simulation |
|---|---|---|
| **Focal** | NPCs in the player's scene | Full cognition: Reflex + Converse + priority Deliberate |
| **Warm** | NPCs in the player's locale / narratively active NPCs (flagged by the Director) | Reflex loop + scheduled Deliberate (minutes-scale); no Converse |
| **Cold** | Everyone else | Statistical simulation: agenda steps advance by deterministic rules + dice; batched LLM "life summary" updates at coarse intervals (game-days/weeks) |

- The scheduler is a priority queue over `(npc, nextThinkAt, tier)` backed by the durable job table (§3.2), budgeted per real-time interval by a **token/cost governor** (§12).
- **Promotion/demotion**: player approaches → cold NPCs get a "wake-up" job that renders their recent statistical history into memories. The Director can pin any NPC to Warm regardless of location.
- **Consistency rule**: statistical simulation may only produce outcomes the rules engine could have produced; wake-up rendering only narrates recorded outcomes. No retroactive fabrication of state.

### 6.6 NPC agents in SkillShop

- One **generic NPC actor agent** (`npc_actor`) registered in SkillShop, parameterized per-execution with persona sheet, retrieved memories, scene + practice context, conversation state, and available tools — *not* one registered agent per NPC (personas are data, agents are code).
- Specialized registered agents: `npc_reflector` (reflection/replanning workflow), `npc_socializer` (batch gossip/relationship updates), plus narrative agents (§8).
- Sessions: each NPC×player conversation maps to a SkillShop session for continuity within a conversation; long-term continuity comes from our memory system, not chat history (Honcho stays disabled).

### 6.7 NPC tools (HTTP callbacks to llmrpg server)

Registered via `POST /api/tools/register-http`; every call authorized against the acting-entity context (§3.2). Initial tool set:

| Tool | Purpose |
|---|---|
| `world_query` | Read-only scoped queries: what the NPC can see/know (enforces knowledge boundary) |
| `memory_search` | Hybrid retrieval over the NPC's own memory/belief stream |
| `npc_act` | Submit an Action (move, give, take, attack, use, emote) to the rules engine |
| `npc_say` | In-scene utterance directed at entities (drives dialogue transcript + events) |
| `update_agenda` | Deliberate-tier only: commit goal/plan changes (validated against persona core) |
| `update_relationship` | Adjust relationship edges with rationale |
| `make_promise` | Record a commitment (creates trackable obligations, §7.3) |
| `quest_propose` | Propose a quest hook sourced from the NPC's own agenda (goes to Director for admission, §9.4) |

Tools declare **entity types** (`npc`, `quest`, `location`, `item`, `faction`, `legend`) at registration so SkillShop SSE events carry navigable metadata — the dev HUD and player journal both consume these.

## 7. Player Experience Architecture

The simulation is only a game if the player can **notice** meaningful changes, **understand** enough causality to choose, **manipulate** the social and physical systems, **anticipate** consequences, **form attachments**, and **recall** what happened. This section is that architecture. Combat stays shallow in R1; these systems carry the game.

### 7.1 The minute-to-minute loop

> **Notice → Investigate → Commit → Act → Observe consequence → Recall.**

Every subsystem below serves a step of this loop. A feature that serves none of them is cut.

### 7.2 Consequence receipts

After a meaningful player action resolves, the journal surfaces a compact, event-grounded **"Because you…"** update: an NPC changed plans, a relationship shifted, a rumor began spreading, a shop changed, a faction clock advanced, an appointment was created. Receipts are generated from actual event/state deltas (event IDs attached; dev HUD can expand them) — never fabricated prose. Receipts are batched and paced by the Director so they inform without spamming; some consequences are deliberately delayed or discovered environmentally instead (§7.6). This is the single highest-leverage legibility mechanism: it makes NPC autonomy perceptible without exposing hidden variables.

### 7.3 Promises, favors, and appointments

Commitments are first-class gameplay objects, not memory annotations: `{ parties, terms, deadline, satisfactionPredicate, breachPredicate, stakes }`. "Meet me at the mill at dusk", "I will keep your secret", "You owe me safe passage", "Enter my district again and I'll have you arrested." Promises create anticipation, appear in the journal with deadlines, are tracked by predicate like quest objectives, and their keeping/breaking writes relationship and reputation consequences. They are the cheapest test of trust, betrayal, memory, and character consistency — no formal quest required. Both NPCs and the player make them (`make_promise` for NPCs; a dialogue act for the player, §7.5).

### 7.4 Investigation: rumor provenance as gameplay

Because beliefs carry provenance (§6.3), the knowledge boundary is playable: ask "Who told you?", trace a rumor to its source, catch a liar (claimed firsthand, wasn't present — `witnessedBy` knows), plant misinformation and watch it spread, compare distorted accounts. The journal's codex tracks claims the player has collected with their sources, supporting Shadows-of-Doubt-style evidence play in dialogue rather than UI-heavy pinboards (R1).

### 7.5 Hybrid dialogue

Free-text conversation remains first-class. Layered on top: contextual **semantic acts** — Ask, Accuse, Bargain, Promise, Lie, Comfort, Threaten, Reveal, Refuse, Leave — offered based on scene state and active social practice (§6.2). Guard rail: acts are *accelerators over free text, not a menu regression*; every act can also be expressed in free text and the engine will classify intent. Acts give the rules engine a reliable intent signal (an Accusation and a Lie have mechanical consequences), improve discoverability of social play, and stop prompt-phrasing skill from being the player's real character sheet.

### 7.6 Visible NPC activity

NPC autonomy must often be legible *without* opening a dialogue window: short contextual barks; visible destinations and changed routines; empty chairs and closed shops; scars and altered equipment; gifts displayed in homes; memorials and graffiti; NPCs meeting, arguing, or avoiding one another on the map. The roguelike presentation makes these cheap (glyph + one-liner). Every Deliberate-tier plan change should ask: what is its observable trace?

### 7.7 The journal is a core gameplay surface

Not a reporting afterthought. Tabs: **Threads** (active quests/promises/appointments with deadlines and clocks), **People** (relationship states, what the player knows about each person and *how they know it*), **Claims** (collected beliefs with provenance), **Chronicle** (session recaps). Post-session, the game generates a concise, event-grounded **recap and character cards** — causal beats, memorable quotes, changed relationships, unresolved promises, new titles/scars/possessions — shareable outside the game (the Nemesis lesson: procedural stories gain value when recallable and tellable).

### 7.8 Player identity: beliefs, vows, and attention

- **Beliefs and vows at character creation** (Burning Wheel pattern): the player states commitments — "No child should pay for a parent's crime", "I will restore my family's name". These are data: the Director *challenges* them (casts storylets that put them under pressure) but never dictates their resolution. Vows appear in the journal; acting with or against them is detected by predicate and feeds the chronicle and legends.
- **Attention management**: the player has a bounded set of active **threads**. Hard cap on major commitments (tunable, ~5); ambient opportunities are explicitly distinguished from major commitments at offer time; quests have deadlines, competing obligations, expiry, and transformation. Refusal is always a valid, consequence-bearing choice ("she asks someone else — the world does not wait"). The Director manages player attention, not merely quest admission (§8.1).

### 7.9 The Milltown acceptance test

The vertical slice — and the exit criterion for the core loop:

> After 60–90 minutes with 8–10 Milltown NPCs, a player can **name three people**, **explain what each wants**, **recount one changed relationship**, and **point to a visible consequence that happened because of their choice**.

The slice structure: meet a small interconnected cast → discover a social conflict → intervene through conversation or another world action → leave or advance time → return and observe consequences through behavior and the environment. If this test fails, adding more agents or more generated quests amplifies noise; we fix the loop before scaling anything.

## 8. The Director (AI Dungeon Master)

The Director is the expert-DM emulation: a privileged narrative agent that shapes pacing and story without owning NPC minds. It is a **drama manager over storylets and clocks**, not a puppeteer — and it is built **deterministic-core-first** (§8.7).

### 8.1 Responsibilities

1. **Pacing & tension**: maintain an explicit tension state machine over the current adventure (build → peak → fade → relax, the Left 4 Dead cycle; recovery periods are mandatory, not accidental). Nudge the world when pacing sags.
2. **Player attention management**: enforce thread caps, sequence quest offers, pace consequence receipts, distinguish ambient vs. major offers (§7.8).
3. **Storylet management**: evaluate the storylet library against world/plot state each narrative tick (§8.3).
4. **Quest admission & weaving** (§9.4): reconcile bottom-up NPC quest proposals with campaign arcs; check witness plans; schedule reveals.
5. **Scene direction — bounded** (§8.2).
6. **Consistency guardianship**: watch the chronicle for contradictions; when fiction and world DB drift, issue corrective events (in-fiction retcons: rumors were wrong).
7. **Spotlight budgeting**: decide which NPCs get Warm status and which background threads advance.

### 8.2 Scene direction without puppeteering

Director briefs to focal NPCs may **only**: expose relevant dramatic context the NPC could plausibly know or feel; suggest pressures and opportunities; control scene selection, participants, and timing. Briefs may **not** override a character's incentives ("do not reveal the ledger" is illegal as a bare instruction). If the drama needs withholding or another behavior change, the Director must supply an **in-world reason the NPC can own** — introduce a fear, a bribe, an interruption, a rival's presence — via validated events, and let the NPC's own cognition respond. Eval probes verify that focal-scene NPC behavior remains explicable from persona + beliefs alone (§13).

### 8.3 Storylets: structured triggers, typed roles

The authorial control surface, engineered for cost, reproducibility, and debuggability (Failbetter quality-based-narrative lesson — *not* per-tick LLM trigger evaluation):

- A storylet = `{ id, trigger (authored in a friendly form, compiled to structured eligibility predicates over world/plot state), roleSlots, dramatic intent, content sketch, constraints, weight, cooldown, arcTags }`.
- **Typed role slots** (Wildermyth casting pattern): Petitioner, Granter, Rival, Witness, Confidant, Betrayer, …. Candidates are **scored deterministically** for each slot from traits, goals, history, and relationships. Late binding is thereby computational and testable, not an LLM instruction.
- **Evaluation pipeline per narrative tick**: compiled predicate filter → deterministic cooldown/role-availability checks → inspectable scoring → *LLM ranking only among ambiguous finalists* → LLM elaboration of the single winner into concrete world changes via validated tools. Every stage's inputs/outputs are logged; a storylet firing is fully reproducible.
- Sources: authored library in `data/storylets/` (genre staples: betrayal reveals, ambushes, moral dilemmas, comic relief, vow challenges) **plus** storylets generated offline by the Campaign Weaver for the current arc (generated storylets pass the same compilation and validation).

### 8.4 Clocks and story sifters

- **Progress clocks** (Blades in the Dark / Dungeon World Fronts): every major NPC or faction plan the Director tracks gets a clock — segmented, predicate-advanced, with *observable milestones* (rumors, environmental changes, journal updates) at authored segments. Clocks make "the world does not wait" legible and let the player triage competing crises. Antagonist forces in campaigns are clock bundles (fronts) with warning signs.
- **Story sifters** (Felt pattern): deterministic, authorable recognizers over the causal event log detect patterns — betrayal, reciprocated kindness, escalating rivalry, violated hospitality, a promise kept at great cost, a secret passing through enemies. Enabled by the causal metadata of §5.2. Sifted patterns feed the chronicle, consequence receipts, session recaps, gossip seeds, and legend forging; the LLM *labels and narrates recognized patterns* rather than reconstructing causality from prose.

### 8.5 Director personas

Pacing policy, difficulty, and prose tone are **separate axes**. Shipping presets (RimWorld storyteller pattern): Measured escalation · Long recovery · Volatile and surprising · Tragic · Comic · Low intervention. A persona parameterizes the tension state machine (slope, peak frequency, recovery length), storylet weighting, and clock speeds — cheap replayability and a player-facing statement of what kind of campaign they want.

### 8.6 Tone configuration

Per-world, player-facing at world creation, covering more than content safety: genre consistency, seriousness vs. comedy, **frequency of anomalous elements** (the alien-brain dial — how often anything-goes intrusions surface), narrative brutality, romance/intimacy, and Director volatility (persona selection). Injected into every generation prompt *and* enforced by admission validators (belt and suspenders).

### 8.7 Implementation strategy: deterministic core first

The Phase-3 Director is a **deterministic state machine with no LLM in the loop**: tension tracking, thread caps, compiled-trigger storylets from the authored library, role scoring, clocks, receipt pacing. The LLM Director roles (storylet elaboration, admission judgment, scene briefs, consistency guardian) layer on in Phase 4. This ordering exists because quest quality cannot be evaluated without pacing and attention management already in place — and because the deterministic core is the debuggable skeleton everything else hangs on.

### 8.8 Director agents and tools in SkillShop

- `director` agent (Phase 4+): storylet elaboration, admission judgment, scene briefs, consistency checks — invoked by the deterministic core, never free-running.
- `campaign_weaver` agent (§10): slow arc-level planner, evaluate/optimize workflow.
- `lore_master` agent (§11): worldgen and legend synthesis.
- Director tools: `plot_state_query`, `fire_storylet`, `spawn_entity` (validated; budgeted), `inject_event`, `admit_quest`, `set_npc_spotlight`, `advance_clock`, `chronicle_append`, `retcon_propose` (two-phase: propose, then validated apply). All require director-role context (§3.2).

### 8.9 Player agency guarantees

- The Director may not directly control the player or negate a player action after validation.
- **Plot-based reflection** (Wu et al. 2025): after significant player choices, the Director re-plans forward rather than steering back. Arcs define *dramatic shapes*, not fixed event sequences; shape → concrete binding happens as late as possible via role scoring (§8.3).
- Failure is content: quests can be failed, NPCs can die, vows can be broken, arcs re-weave around the wreckage.

## 9. Quest System — "Infinite Sidequests"

### 9.1 Quest representation

A quest is a typed, validated artifact (never free prose):

- `Quest = { id, title, giver, motivation (link into giver's agenda), premise, objectiveGraph, stakes, rewards, failureConsequences, expiry, commitmentClass (ambient | major), arcTags, state }`
- `objectiveGraph`: DAG of objectives; each objective = `{ description, satisfactionPredicate (world-state predicate), optional hints, outcomeClasses }`. Predicates are evaluated by the engine against events/state — quest progress is *detected*, never self-reported by an LLM.
- **Outcome classes are richer than pass/fail**: `success`, `successWithCost` (first-class: achieve the goal but incur debt; save one person, lose another opportunity; learn the truth, expose the source; win the fight, advance an enemy clock), `failure`, `softFail`, `abandoned`, `transformed`. Generators are required to author at least one `successWithCost` path for major quests — it is where tabletop stories become memorable.
- Branches are first-class: multiple satisfaction paths per node (persuade | steal | fight), and discovered paths — predicates added mid-quest when the player invents an approach.

### 9.2 Generation pipeline (dependency-driven, schema-governed)

1. **Hook**: bottom-up (NPC `quest_propose` from a real agenda item), top-down (arc need from the Campaign Weaver), or ambient (worldgen seeds).
2. **Draft**: `quest_designer` agent expands hook → full quest artifact, conditioned on giver persona + backstory, local world digest, active arc and clocks, player history digest (including vows), tone config.
3. **Normalize**: deterministic repair of common defects (unresolved entity references matched or flagged; missing fields defaulted).
4. **Validate & admit — bounded solvability certificates.** Proving general reachability in a changing open world is not realistic. Instead the generator must emit one or more **witness plans**: concrete action sequences that would satisfy each objective path. The validator checks each witness plan against current world state within a bounded planning horizon, and records the plan's **assumptions** (entities alive, items in place, factions neutral). Assumptions are monitored; when the world invalidates one, the quest is flagged for **transformation** (§9.5) rather than silently breaking. Plus: schema compliance, referential integrity, stakes/reward bounds, tone/content policy. Implemented as an evaluate/optimize workflow: reject with reasons → revise → bounded retries → admit or discard (logged).
5. **Instantiate**: spawn manifest applied (items placed, NPCs given beliefs, clues distributed with provenance), quest offered through the giver's normal behavior — conversation, rumor, or event, never a "!" icon. The Director sequences the offer against thread caps (§7.8).

### 9.3 Backstory pairing

Every generated quest binds to generated **backstory**: the quest_designer receives (and may extend) the giver's backstory and local lore; its output includes backstory deltas admitted into the lore graph (§11) so quests deepen the world instead of floating on it. **Quest chains are lore-graph traversals** — three sidequests later the player realizes they've been excavating one buried story.

### 9.4 Quests from NPC agendas (the differentiator)

Bottom-up flow: NPC Deliberate tier hits a plan step it cannot achieve alone → emits `quest_propose` with the *real* agenda linkage → Director admission checks dramatic fit, thread load, and redundancy → admitted proposals go through pipeline steps 2–5. Because the motivation is real, outcomes genuinely change the NPC: complete the blacksmith's ore run and her forge output rises, her goal progresses, her gratitude is a relationship edge with memory behind it — and the receipt (§7.2) shows it. Refuse, and she asks someone else.

### 9.5 Dynamic evolution

- State machine: `offered → active → (branch states) → resolved(outcomeClass)`.
- **Transformation**: the Director may rewrite the remaining objectiveGraph mid-quest — triggered by player action, world events, or invalidated witness-plan assumptions (the fugitive you were hunting was assassinated; who hired the assassin?). Transformations pass the same validate/admit gate.
- All resolutions write consequences: relationship changes, faction standing, economic effects, clock advances, chronicle entries, receipts, potential follow-on hooks.

## 10. Campaign System

- A **campaign** = an arc skeleton: `{ theme, dramatic shape (act structure with tension targets), antagonist front (faction/entity clock bundle with its own Warm-simulated agenda and warning signs), arc storylets, entry hooks, stakes questions, possible climaxes (plural), epilogue hooks }`.
- **Stakes questions** (DramaSystem/Apocalypse World pattern): every campaign carries unresolved questions — "Will the old alliances hold?", "Does the player's vow survive contact with power?" — whose answers the Weaver **may not preselect**. They are resolved only by play; act-progression predicates detect when an answer has effectively been given.
- The **Campaign Weaver** builds arcs from what exists: it mines the world DB, chronicle, clocks, and player history (including vows and broken promises) for tensions, and proposes an arc that *recruits* existing NPCs and lore rather than inventing a parallel cast.
- Adventures are beads on the arc string; the Weaver plans one act ahead in detail, later acts as shape only (late binding via storylet role scoring).
- Arc progression is event-driven; the Director paces reveals via storylets and clock milestones.
- Campaign completion writes a **saga record** — the top-level input to legend generation (§11.3).

## 11. Worldgen, Lore, and Legends

### 11.1 World generation (offline pipeline, staged like the quest pipeline)

1. **Physical**: region map (biomes, settlements, roads, dungeons) — deterministic PCG with seeds; LLM names and flavors.
2. **Mythic history** (Dwarf Fortress inspiration): `lore_master` simulates compressed history in eras — founding myths, wars, migrations, calamities, hero-figures — emitting a **lore graph**: entities + typed relations + era timestamps. Schema-validated like everything else.
3. **Present-day cast**: factions and settlement rosters generated *from* the lore graph (the innkeeper descends from a war hero; the ruined tower belonged to a named wizard whose apprentice's ghost holds a grudge). Persona sheets, relationships, and agendas seeded with lore hooks.
4. **Seeding**: initial storylet bindings, ambient hooks, secrets distribution — the initial belief/provenance map of who knows what.

### 11.2 The Chronicle

The in-fiction record of the *current* era: a structured, append-only narrative event store (distinct from the raw event log — the chronicle is curated). Entries come from sifted story patterns (§8.4), quest resolutions, deaths of named NPCs, faction/clock shifts, vow keepings and breakings, and player deeds above an importance threshold — each entry grounded in event IDs. The chronicle powers the journal, session recaps, gossip seeds, campaign weaving, and legend generation.

### 11.3 Legends and multi-playthrough persistence

- Worlds persist; characters are mortal. At playthrough end, a **legend-forging pass** runs: `lore_master` compresses the playthrough's chronicle and sifted patterns into legend entries with *era-appropriate distortion* — mechanically, an extension of belief distortion history (§6.3) run at generational scale, with an accuracy-decay parameter. Deeds inflate, motives mythologize, names shift.
- **Constrained ex-post rationalization** (Caves of Qud pattern): legends are encountered through artifacts — statues, songs, shrines, engravings, relics, disputed histories — in discovery order, and the lore_master may backfill *connective* detail around fixed chronicle facts but may never contradict them.
- Next playthrough in the same world: time advances (configurable gap), the world simulates the interregnum in coarse strokes, and the new character finds rival claimants to their predecessor's legacy — and NPCs who remember the previous character personally if the gap is short.
- The previous character can optionally be instantiated as a legend-NPC (ghost, portrait, tomb guardian) with a persona distilled from their actual play history.

## 12. LLM Budget, Latency, and Model Tiering

Cost is a design constraint, not an afterthought.

- **Model tiers** (configured per agent in SkillShop registration):
  - Frontier model: Director elaboration/judgment, Campaign Weaver, quest design, legend forging (low frequency, high leverage).
  - Mid model: focal NPC dialogue (quality matters, streamed).
  - Small/cheap model: importance scoring, intent classification for free-text dialogue acts, ambiguous-finalist storylet ranking, gossip batching, cold-NPC life summaries, embeddings. (Future: fine-tuned small model for NPC chatter, per the PLAYER:NPC distillation pattern.)
- **Deterministic before generative**: storylet triggers, role scoring, clocks, sifters, receipts, and conversation-state enforcement are all LLM-free by design (§8) — the single largest cost decision in the architecture.
- **Token governor**: per-world budgets (per real-hour and per game-day) enforced by the NPC scheduler and Director; when budget tightens, Deliberate jobs stretch intervals and cold-tier batch sizes grow. Hard caps fail visible (dev HUD warning), never silent.
- **Caching**: persona prompt prefixes stable per NPC (prompt-cache friendly); world digests memoized per locale per tick; embeddings cached permanently.
- **Full telemetry**: every LLM call tagged `(world, agent, npc, tier, purpose, promptVersion, model)` with tokens/latency/cost recorded — the eval framework and the governor both read this.

## 13. Evaluation Framework

Built alongside the game. Lives in `server/eval/`. Believability and consistency are means; the product outcome is the player experience — so the framework measures both.

### 13.1 Tiers

| Tier | What | How |
|---|---|---|
| **Micro: NPC believability** | Persona consistency, knowledge-boundary violations, personality back-testing, memory-grounding accuracy, **scene-brief compliance** (behavior explicable from persona + beliefs alone, §8.2), conversation-discipline adherence | Scripted probe conversations by a **simulated player agent**; LLM judge scores against ground-truth persona sheet and belief stream |
| **Meso: quest & scene quality** | Witness-plan validity, assumption monitoring coverage, coherence with lore, objective clarity, branch fairness, outcome-class distribution (are successWithCost paths real?), reward calibration; storylet-firing reproducibility | Deterministic predicate checks (zero-judge) + LLM-judged narrative rubric on artifacts and transcripts |
| **Macro: world liveliness** | Event density, relationship-graph churn, information diffusion and distortion rates, clock progression, arc completion, contradiction counts, cost-per-game-day | Unattended "aquarium runs": N game-days with no player or a simulated player; metrics from event log + chronicle |
| **Player experience** | Attachment to named NPCs; recall after a session; perceived consequence; decision meaningfulness; surprise without confusion; world-state comprehension; conversation abandonment rate; **time to first memorable event**; ability to explain why an NPC acted; ability to predict one likely consequence | In-client instruments (dev builds): post-session micro-surveys, the Milltown test protocol (§7.9), dialogue thumbs; correlated against automated judges to calibrate them |

### 13.2 Architectural baselines

Every expensive architectural claim gets an ablation baseline, run in the same harness:

- **No-LLM NPCs** (behavior trees + templated dialogue)
- **One global actor** for all NPCs (Open-Theatre Director–Global-Actor — may be embarrassingly competitive for background NPCs; if so, that's a cost win, not a failure)
- **Authored storylets only** (no generated quests)
- **Memory without reflection**
- **Dialogue without consequence receipts**

Without these, the project risks demonstrating sophisticated agent behavior without proving the expensive architecture improves *play*.

### 13.3 Harness

- **Golden scenarios**: fixed world seeds + scripted player trajectories replayed against every significant change; metric diffs gate merges. Storylet and sifter determinism makes most of the narrative core replayable exactly.
- **Simulated players**: LLM player agents with play-style personas (murder-hobo, diplomat, completionist) for soak tests and adversarial probing (persona-breaking, exploit-hunting, prompt injection).
- **Cost/latency dashboards** from §12 telemetry; regression thresholds on cost-per-scene and p95 dialogue first-token latency.

## 14. Data Model Summary (per-world DB)

Core tables (all zod-schema'd in `shared/`, mirrored in SQLite):

- `entities`, `components` (typed JSON per component kind)
- `events` (append-only, causal metadata §5.2), `actions` (submitted/validated/applied audit)
- `npc_state` (agenda, tier, scheduler bookkeeping), `memories`, `beliefs` (provenance, distortion history), `relationships`, `promises` (§7.3), `conversation_state`
- `jobs` (durable Deliberate-tier outbox, §3.2)
- `quests`, `objectives`, `witness_plans` (+ assumptions), `quest_events`
- `arcs`, `stakes_questions`, `storylets`, `storylet_firings`, `clocks`, `sifter_patterns`, `sifted_stories`
- `practices` (social practice definitions + active instances)
- `player_vows`, `receipts`
- `lore_nodes`, `lore_edges`, `chronicle`, `legends`, `sagas`
- `playthroughs`, `player_history_digest`
- `llm_calls` (telemetry incl. prompt/model versions), `eval_runs`, `eval_metrics`

SkillShop's own DB stores only agents/tools/sessions/chats; no game state lives there.

## 15. Security & Content Controls

- **Prompt-injection surface**: player free-text reaches NPC prompts. Mitigations: player input always delimited and role-tagged; tools enforce knowledge boundary, acting-entity authorization (§3.2), and action validation regardless of what the model "believes"; Director consistency checks catch persona hijacks. Red-team probes are part of the eval suite.
- **Tone configuration** (§8.6): injected into every generation prompt *and* enforced by admission validators.
- **Tool RBAC**: llmrpg tool endpoints authorize against the acting-entity context block; an NPC cannot read another's memory stream; Director tools require director-role context.

## 16. Technology Stack

- TypeScript end-to-end. Client: React + Vite + Tailwind (mirrors SkillShop conventions). Server: Express, better-sqlite3, zod, drizzle-orm.
- SkillShop submodule pinned; service mode env per SKILLSHOP_SERVICE.md (`SKILLSHOP_SERVICE_MODE=true`, `VPS_ENABLED=false`, `MCP_ENABLED=false`, `ALLOWED_ORIGINS` for :4001/:4002).
- Dev orchestration: extend `scripts/ensure-dev.sh` / `scripts/kill-all-processes.sh` conventions to manage all three processes; SkillShop DB initialized via its `db:init`/`db:load`.
- Embeddings: provider via SkillShop; vector search via SQLite (sqlite-vec) — decision task in Phase 2 (alternative: in-process HNSW).

## 17. Implementation Roadmap

Phases are cumulative; each ends with a playable/demonstrable milestone and its slice of the eval harness. The re-cut principle (per the design review): **prove the player loop on a handcrafted small town before generating or scaling anything**, and bring a minimal deterministic Director up *before* the full quest generator.

### Phase 0 — Foundations (skeleton walk)
Repo scaffolding (client/server/shared/eal); SkillShop submodule boots in service mode with DB init; llmrpg server registers one hello-world agent + one HTTP tool and round-trips an execution with SSE into a stub client page; **idempotency-key and acting-entity-context conventions established in the first tool** (§3.2); dev scripts manage all processes; CI with typecheck + unit tests.
**Milestone**: chat with a placeholder NPC in the browser through the full three-process pipeline.

### Phase 1 — Engine core & roguelike client
EAL core interfaces; **revision-stamped snapshot/delta protocol** (§4.2); roguelike-web adapter (glyph renderer, FOV, input); world DB + entity/component model; Action system + rules engine v1 (move, take, give, use, attack-lite, talk); **event log with causal metadata** (`causedBy`, `witnessedBy`, `narrativeTags` — §5.2); single handcrafted test locale ("Milltown"); turn ticker; client panels (map, log, dialogue modal, journal shell).
**Milestone**: walk around Milltown, pick things up, open a dialogue window with a static NPC; disconnect/reconnect resumes cleanly.

### Phase 2 — NPC cognition + the player loop (the vertical slice)
*Cognition*: persona sheets + agenda model (diegetic drives only); memory + **belief store with provenance** (§6.3); hybrid retrieval; perception filter; `npc_actor` + core tools; Reflex tier (routines/schedules); Converse tier with streaming dialogue and **conversation discipline state** (§6.4); reflection via loop workflow through the **durable job table**; scheduler v1 (Focal/Warm).
*Player experience*: **consequence receipts**; **promises/appointments as tracked objects**; **hybrid dialogue** (semantic acts + free-text intent classification); **visible NPC activity** (barks, routine changes, environmental traces); journal v1 (Threads, People, Claims); character creation with **beliefs/vows**.
*Content*: 8–10 handcrafted Milltown NPCs with interlocking relationships, secrets with provenance, and at least one live social conflict.
**Milestone**: **the Milltown acceptance test passes** (§7.9). Micro-eval suite v1 + player-experience instruments running; global-actor baseline measured against per-NPC agents.

### Phase 3 — Minimal deterministic Director + first quests
*Director core (no LLM in the loop)*: tension state machine with recovery periods; thread caps and offer sequencing; **authored storylet library** with compiled triggers + typed role scoring (§8.3); **one visible antagonist/faction clock** with observable milestones; receipt pacing.
*Quests v1*: quest schema with **outcome classes incl. successWithCost**; predicates + state machine; bottom-up `quest_propose` from NPC agendas; generation pipeline (hook→draft→normalize→validate→admit→instantiate) with **witness-plan solvability certificates** (§9.2); transformation on invalidated assumptions; three social practices (bargaining, hospitality, testimony).
**Milestone**: a paced stream of coherent, agenda-grounded quests in Milltown with real refusal costs, deadlines, and at least one memorable success-with-cost outcome per session. Meso-eval suite v1.

### Phase 4 — LLM Director, sifters, and the chronicle
`director` agent layered onto the deterministic core: storylet elaboration, admission judgment, **bounded scene briefs** (§8.2), consistency guardian; **story sifters** over the causal log; chronicle + session **recaps and character cards** (§7.7); **Director personas** (§8.5); full quest generation quality pass.
**Milestone**: sessions have pacing — twists land at the right time, quiet stretches get stirred, recaps read like stories someone would retell. Scene-brief-compliance and sifter-precision evals live.

### Phase 5 — Worldgen, lore, and scale
Physical worldgen (regions, settlements, dungeons); mythic-history pipeline → lore graph; cast generation from lore; Cold tier + statistical simulation + wake-up rendering; token governor + full telemetry; model tiering config; **tone configuration UI** at world creation (§8.6); macro-eval aquarium runs **including the architectural baselines** (§13.2).
**Milestone**: a generated world of 100+ NPCs across multiple locales runs within budget; travel somewhere new and find NPCs whose lives moved on without you — and the baselines quantify what the full architecture buys.

### Phase 6 — Campaigns
Campaign Weaver (arc mining from world/chronicle/clocks/player history incl. vows); arc skeletons with **stakes questions** (§10) and late binding via role scoring; antagonist **fronts** (clock bundles with warning signs); act-progression predicates; arc storylet generation; climax/epilogue handling; saga records.
**Milestone**: complete a multi-adventure campaign whose antagonist was visibly plotting all along, whose stakes questions were answered by play, and whose finale reflects accumulated player choices.

### Phase 7 — Legends & multi-playthrough worlds
Legend-forging pass (distortion-history mechanics at generational scale, constrained ex-post rationalization — §11.3); interregnum simulation; new-playthrough bootstrapping into a persisted world; memorialization content (statues, songs, tomb-NPCs); legacy hooks into campaign weaving.
**Milestone**: die gloriously, start a new character fifty years later, and hear a distorted ballad about yourself in a tavern.

### Phase 8 — Hardening, extraction go/no-go, second adapter
Adversarial/red-team eval expansion; cost optimization round (distilled small model for NPC chatter — go/no-go on fine-tuning using transcripts + judge scores collected since Phase 3); performance (scheduler under 500+ NPCs); **framework-extraction decision** — now informed by which abstractions survived Milltown-to-worldgen intact (G1); a second EAL adapter spike (minimal tile-sprite or 3D-lite renderer) to prove the abstraction.
**Milestone**: stable long-session play; EAL validated by a working second adapter; extraction decision documented.

## 18. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Simulation invisible to the player ("sophisticated noise") | Consequence receipts, visible activity, clocks, journal-as-gameplay — all Phase 2–3 core; the Milltown test gates scaling |
| LLM cost blows up with NPC count | Deterministic-before-generative design; cognition LOD + token governor + model tiering; baselines quantify spend vs. experience |
| Dialogue latency breaks immersion | Streaming everywhere; Reflex tier for instant reactions; conversation state caps verbosity; prompt-cache-stable personas |
| Narrative drift / world contradictions | Single source of truth, validated tools only, admission gates, Director consistency guardian, chronicle audits |
| Generated quests are samey | Diversity metrics; hook-source mixing; outcome-class requirements; storylet breadth; lore-graph traversal chains |
| Director railroads the player | Bounded briefs with in-world reasons (§8.2), late binding via role scoring, plot-reflection replanning, stakes questions, failure-is-content, agency metrics |
| Infinite quests dilute meaning | Thread caps, deadlines, refusal costs, ambient/major distinction, Director attention management |
| Storylet system undebuggable | Compiled triggers, deterministic scoring, logged pipeline stages, exact replayability |
| SkillShop service coupling too tight | Thin `server/agents/` gateway; agents/tools registered from data; hardened boundary (§3.2) doubles as a seam |
| Prompt injection via player chat | Delimited inputs, tool-side authorization as the real boundary, red-team suite |
| Framework ambition slows the game | Extraction explicitly deferred to Phase 8 go/no-go (G1) |

## 19. Open Questions (tracked as decision tasks)

1. Vector search implementation (sqlite-vec vs. in-process HNSW) — Phase 2.
2. rot-js vs. bespoke FOV/pathfinding — Phase 1.
3. Real-time (fixed-step) vs. strictly turn-based background ticks for the focal locale — prototype both in Phase 2; affects conversation/world-time interleaving.
4. Free-text intent classification model and taxonomy for dialogue acts (§7.5) — Phase 2.
5. Storylet trigger authoring format (what "author-friendly, compiled to predicates" concretely looks like) — Phase 3 spike before the library is written.
6. Multiplayer-safe world-state partitioning — keep the Action/Event model compatible; no commitment before Phase 8.
7. Fine-tuned NPC chatter model: data collection (transcripts + judge scores) starts Phase 3; decision Phase 8.
