# llmrpg Design Document

An LLM-powered RPG built around societies of autonomous NPC agents. This document specifies the architecture, subsystems, data model, and implementation roadmap. It contains no implementation code; it is the blueprint from which implementation issues are cut.

Companion document: [NPC Agent Literature Review](../research/NPC_AGENT_LITERATURE.md) — the published research this design draws on, with per-area design implications.

---

## 1. Vision

llmrpg replicates the experience of playing D&D with an expert dungeon master — one who combines great storytelling with creative tactical and side-quest twists — in an open game world populated by long-running agentic NPCs. NPCs live in the world as autonomous beings with their own agendas, motivations, goals, and aspirations. They are improvisational players on an open-world stage, motivated (by explicit design) to create memorable stories for the human player.

Setting: **Tolkienesque fantasy, anything-goes plot elements.** The thieves' guild leader may be a zombie controlled by an alien brain in a vat in low earth orbit. The tone rules are a world-configuration knob, not an engine constraint.

Three signature experiences:

1. **Infinite sidequests** — procedurally generated backstories paired with choose-your-own-adventure dynamics; NPCs react and evolve with the storyline rather than dispensing static quest text.
2. **Campaigns** — individual adventures strung into larger story arcs with foreshadowing, escalation, and payoff.
3. **A living, remembering world** (Dwarf Fortress inspiration) — generated lore, myth, and legend; persistent worlds across playthroughs where the player's previous lives are memorialized in new legends.

## 2. Goals and Non-Goals

### Goals

- **G1**: A generic agentic framework for societies of NPCs — reusable beyond this game.
- **G2**: Engine independence via an internal abstraction layer; first target is a browser-based 2D roguelike UI.
- **G3**: SkillShop (as a git submodule, run in service mode) provides all LLM orchestration, agent execution, streaming, and session management.
- **G4**: NPCs are the product. Graphics are deliberately minimal in R1 so effort concentrates on agent quality.
- **G5**: Built-in evaluation: NPC believability, quest quality, and world-liveliness are measured continuously, not vibes-checked.
- **G6**: Production-ready codebase from the start (real persistence, real cost controls, real error handling).

### Non-Goals (for R1)

- 3D rendering, physics, animation (the abstraction layer anticipates them; R1 does not build them).
- Multiplayer (data model must not preclude it; netcode is out of scope).
- Combat depth competitive with dedicated roguelikes — R1 combat is a simple, serviceable turn-based system that exists to give quests stakes.
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

**Division of authority — the load-bearing rule of this design**: *LLMs propose; the llmrpg server disposes.* Every world mutation flows through the rules engine as a validated **Action**. Agents can only affect the world through registered tools whose handlers validate against the world DB. This is the "LLM proposes, symbolic engine validates" pattern the literature converges on (Metagent-P, G-KMS, HeRoN — see literature review §1.3, §3).

### 3.2 Monorepo layout

```
llmrpg/
├── client/            # Browser game client
├── server/            # llmrpg game server
│   ├── engine/        # Simulation kernel, rules engine, action system
│   ├── world/         # World model, worldgen, lore/legends
│   ├── npc/           # Cognitive architecture, scheduler, memory
│   ├── narrative/     # Director, quests, campaigns, storylets, chronicle
│   ├── agents/        # Agent prompt templates + SkillShop registration
│   ├── tools/         # HTTP tool endpoints called by SkillShop
│   └── eval/          # Evaluation harness, simulated players, metrics
├── shared/            # Types/schemas shared client↔server (zod)
├── eal/               # Engine Abstraction Layer: core interfaces + adapters
│   ├── core/          # Engine-agnostic interfaces
│   └── adapters/roguelike-web/   # R1 adapter
├── skill-shop/        # Submodule (service mode)
├── data/              # Static content packs: races, cultures, name banks,
│                      #   quest templates, storylet libraries, tone configs
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
- All EAL calls are synchronous-looking over an async boundary; adapters may render remotely (browser) from a server-authoritative state via a snapshot/delta protocol.

### 4.2 R1 adapter: `roguelike-web`

- Canvas/WebGL glyph renderer (evaluate `rot-js` for FOV/pathfinding utilities vs. small bespoke implementations; decision task in Phase 1).
- Classic roguelike presentation: glyph map, message log, side panel (stats, time, location), modal dialogue window for NPC conversations with streaming text (SSE pass-through from SkillShop).
- Turn-based ticker: the world advances when the player acts; background simulation ticks are decoupled (§6.4).

## 5. World Model

### 5.1 Entity model

Entity-Component style records in the world DB (not a full archetype-ECS runtime in R1 — a component-tagged relational model that can be ported to a real ECS later):

- **Entity**: stable UUID, kind (`npc`, `player`, `item`, `location`, `faction`, `creature`, `structure`, …), name, tags.
- **Components** (per-kind, typed, zod-validated): `Position`, `Stats`, `Inventory`, `Persona` (NPC), `Agenda` (NPC), `Relationships`, `FactionMembership`, `QuestGiver`, `Lore`, `Container`, `Portal`, etc.
- **Spatial hierarchy**: World → Region → Locale (town, dungeon level, wilderness cell) → Tile. Locales are the streaming/simulation unit.

### 5.2 World state authority

- One **SQLite database per world** (a "world" persists across playthroughs; a playthrough is a character-run within a world). A small shared meta DB indexes worlds/saves/settings.
- All mutations flow through the **Action system**: `Action = { actor, verb, targets, params }` → rules engine validates (permissions, physics, resources, reachability) → applies → emits **Events**. Events are the lingua franca: they feed NPC perception, quest predicate evaluation, the chronicle, and client deltas.
- **Event log** is append-only per world — it is simultaneously the NPC perception source, the replay/debug record, and the raw material for lore generation.

### 5.3 Time

- **Game clock** decoupled from wall clock. R1: player-turn-driven in the active locale, with a background scheduler advancing off-screen locales in coarse increments (§6.4).
- Calendar with seasons/years — required for legends ("in the Year of the Broken Crown…") and NPC life-cycles.

## 6. NPC Cognitive Architecture

The heart of the project. Per the literature review, the architecture combines the Generative-Agents memory model with PIANO-style split-speed cognition and strict symbolic validation.

### 6.1 NPC anatomy

Every NPC has:

1. **Persona sheet** (authored or generated; immutable core + mutable surface):
   - Core: name, species/culture, backstory summary, personality (trait vector + prose), values, fears, speech style, secrets, true allegiances (the zombie-guild-leader's alien controller lives here).
   - Surface (mutable): current mood, health, wealth tier, public reputation, location, occupation.
2. **Agenda**: hierarchy of drives → goals → plans → next intents.
   - *Drives* (near-permanent): survive, prosper, protect family, seek the throne, serve the vat-brain.
   - *Goals* (weeks-months of game time): "become guildmaster", "find who killed my brother".
   - *Plans*: ordered steps toward a goal, each step an abstract action with preconditions.
   - *Intents*: the next concrete Action(s) to submit to the rules engine.
3. **Memory** (§6.3).
4. **Relationship model**: typed, directional edges to other entities (trust, affection, fear, debt, rivalry; numeric weight + prose annotations). Includes *beliefs about others' goals* — required for social differentiation (Project Sid finding).
5. **Knowledge boundary**: what the NPC knows vs. what is true. NPCs act on beliefs; the Director exploits the gap for dramatic irony.

### 6.2 Split-speed cognition (three tiers)

| Tier | Latency budget | Mechanism | Used for |
|---|---|---|---|
| **Reflex** | ~0 (no LLM) | Rules/behavior trees over agent state | Movement along a planned path, flee-on-low-HP, greetings, routine job actions, combat rounds |
| **Converse** | interactive (streamed) | SkillShop agent execution with persona prompt + retrieved memories + scene context | Dialogue with the player or other NPCs in the focal scene |
| **Deliberate** | seconds–minutes, off-turn | SkillShop workflow agents (loop / evaluate-optimize) run by the NPC scheduler | Reflection, replanning, goal revision, relationship updates, gossip digestion |

A shared **agent state** record (world DB) is the single source each tier reads/writes — the PIANO "shared state + bottleneck" pattern. The Deliberate tier is the only writer of goals/plans; Converse can propose plan changes ("I'll meet you at the mill at dusk") which are committed as *promises* the Deliberate tier reconciles.

### 6.3 Memory system

Direct adoption of the Generative-Agents design, adapted to a game:

- **Memory stream** per NPC: observation records `{ time, type: observation|thought|promise|reflection, text, subjects[], importance, embedding }` stored in the world DB (embeddings via SkillShop's LLM providers, cached).
- **Perception filter**: NPCs don't observe raw events; a per-NPC filter converts world Events within their perception range into observations, with LLM-free templated rendering for routine events and importance scoring batched through a cheap model.
- **Retrieval**: weighted recency × relevance × importance (tunable weights, start at the reference 0.5/3/2), top-k into prompt context.
- **Reflection**: importance-accumulator threshold triggers a Deliberate-tier reflection job (SkillShop loop workflow): synthesize salient questions → answer from memories → store reflections. Reflections feed persona drift (mood, relationships, goal weights) within bounds set by the immutable persona core.
- **Forgetting/compaction**: periodic compaction summarizes cold low-importance memories into digest records; originals are archived (event log keeps ground truth). Keeps retrieval sharp and cost bounded over months of game time.
- **Social memory propagation**: gossip is a first-class mechanism — NPCs exchange belief records during co-located social time (mostly simulated statistically off-screen, LLM-rendered only when the player is present). This is how player deeds become reputation and eventually legend.

### 6.4 The NPC scheduler and simulation LOD

Cost and believability both demand level-of-detail simulation:

| LOD | Applies to | Simulation |
|---|---|---|
| **Focal** | NPCs in the player's scene | Full cognition: Reflex + Converse + priority Deliberate |
| **Warm** | NPCs in the player's locale / narratively active NPCs (flagged by the Director) | Reflex loop + scheduled Deliberate (minutes-scale); no Converse |
| **Cold** | Everyone else | Statistical simulation: agenda steps advance by deterministic rules + dice; batched LLM "life summary" updates at coarse intervals (game-days/weeks) |

- The scheduler is a priority queue over `(npc, nextThinkAt, tier)`, budgeted per real-time interval by a **token/cost governor** (§11).
- **Promotion/demotion**: player approaches → cold NPCs get a "wake-up" job that renders their recent statistical history into memories (so the innkeeper "remembers" the past week without having simulated it expensively). The Director can pin any NPC to Warm regardless of location (your nemesis plots even when far away).
- **Consistency rule**: statistical simulation may only produce outcomes the rules engine could have produced; wake-up rendering only narrates recorded outcomes. No retroactive fabrication of state.

### 6.5 NPC agents in SkillShop

- One **generic NPC actor agent** (`npc_actor`) registered in SkillShop, parameterized per-execution with persona sheet, retrieved memories, scene context, and available tools via the template-variable/context mechanism — *not* one registered agent per NPC (thousands of NPCs; agents are code, personas are data).
- Specialized registered agents: `npc_reflector` (reflection/replanning workflow), `npc_socializer` (batch gossip/relationship updates), plus narrative agents (§7).
- Sessions: each NPC×player conversation maps to a SkillShop session for continuity within a conversation; long-term continuity comes from our memory system, not chat history (Honcho stays disabled).

### 6.6 NPC tools (HTTP callbacks to llmrpg server)

Registered via `POST /api/tools/register-http`, executed against the world DB with validation. Initial tool set:

| Tool | Purpose |
|---|---|
| `world_query` | Read-only scoped queries: what the NPC can see/know (enforces knowledge boundary) |
| `memory_search` | Retrieve from the NPC's own memory stream |
| `npc_act` | Submit an Action (move, give, take, attack, use, emote) to the rules engine |
| `npc_say` | In-scene utterance directed at entities (drives dialogue transcript + events) |
| `update_agenda` | Deliberate-tier only: commit goal/plan changes (validated against persona core) |
| `update_relationship` | Adjust relationship edges with rationale |
| `make_promise` | Record a commitment (creates trackable narrative obligations) |
| `quest_propose` | Propose a quest hook sourced from the NPC's own agenda (goes to Director for admission, §8.4) |

Tools declare **entity types** (`npc`, `quest`, `location`, `item`, `faction`, `legend`) at registration so SkillShop SSE events carry navigable metadata — the dev HUD and player journal both consume these.

## 7. The Director (AI Dungeon Master)

The Director is the expert-DM emulation: a privileged narrative agent that shapes pacing and story without owning NPC minds. Per the literature (Open-Theatre, Drama Llama, CALYPSO), it is a **drama manager over storylets**, not a puppeteer.

### 7.1 Responsibilities

1. **Pacing & tension**: maintain a tension model of the current adventure (setup → rising → climax → resolution); nudge the world when pacing sags (a rumor arrives, a rival acts, weather turns).
2. **Storylet management**: evaluate the storylet library against world/plot state each narrative tick; fire triggers (§7.2).
3. **Quest admission & weaving** (§8.4): reconcile bottom-up NPC quest proposals with campaign arcs; ensure solvability; schedule reveals.
4. **Scene direction**: for a focal scene, brief participating NPC agents with *dramatic context* ("you suspect the player lies; do not reveal the ledger yet") layered onto — never overriding — their personas.
5. **Consistency guardianship**: watch the chronicle for contradictions; when the fiction and the world DB drift, issue corrective events (in-fiction retcons: "you misremembered", rumors were wrong).
6. **Spotlight budgeting**: decide which NPCs get Warm status and which background threads advance.

### 7.2 Storylets

The authorial control surface (Drama Llama pattern):

- A storylet = `{ id, natural-language trigger, dramatic intent, content sketch, constraints, weight, cooldown, arc-tags }`.
- Sources: authored library in `data/storylets/` (genre staples: betrayal reveals, ambushes, moral dilemmas, comic relief) **plus** storylets generated by the Campaign Weaver for the current arc.
- Each narrative tick (player scene transitions, quest state changes, game-day boundaries), a **trigger-evaluation call** (cheap model, router-style) matches candidate storylets against a compact digest of plot state; the Director elaborates the winner into concrete world changes via validated tools.

### 7.3 Director implementation in SkillShop

- `director` agent: the per-tick narrative decision maker (Converse-tier latency, runs off the player's turn).
- `campaign_weaver` agent (§9): slow arc-level planner, run as an evaluate/optimize workflow.
- `lore_master` agent (§10): worldgen and legend synthesis.
- Director tools: `plot_state_query`, `fire_storylet`, `spawn_entity` (validated; budgeted), `inject_event`, `admit_quest`, `set_npc_spotlight`, `chronicle_append`, `retcon_propose` (two-phase: propose, then validated apply).

### 7.4 Player agency guarantees

- The Director may not directly control the player or negate a player action after validation.
- **Plot-based reflection** (Wu et al. 2025): after significant player choices, the Director re-plans forward rather than steering back to a predetermined path. Arcs define *dramatic shapes* (there will be a betrayal, a revelation, a confrontation), not fixed event sequences; the binding of shape → concrete actors/locations happens as late as possible ("late binding" is the core railroading defense).
- Failure is content: quests can be failed, NPCs can die, arcs re-weave around the wreckage.

## 8. Quest System — "Infinite Sidequests"

### 8.1 Quest representation

A quest is a typed, validated artifact (never free prose):

- `Quest = { id, title, giver (entity), motivation (link into giver's agenda), premise, objectiveGraph, stakes, rewards, failureConsequences, expiry, arcTags, state }`
- `objectiveGraph`: DAG of objectives; each objective = `{ description, satisfactionPredicate (world-state predicate), optional hints, softFail conditions }`. Predicates are evaluated by the engine against events/state — quest progress is *detected*, never self-reported by an LLM.
- Branches are first-class: multiple satisfaction paths per node (persuade | steal | fight), discovered paths (predicates can be added mid-quest by the Director when the player invents an approach — this is the choose-your-own-adventure dynamic).

### 8.2 Generation pipeline (dependency-driven, schema-governed)

Following World-Gen-to-Quest-Line + G-KMS (literature §3):

1. **Hook**: sourced bottom-up (NPC `quest_propose` from a real agenda item) or top-down (arc need from the Campaign Weaver) or ambient (worldgen seeds: ruins imply mysteries).
2. **Draft**: `quest_designer` agent expands hook → full quest artifact, conditioned on: giver persona + backstory, local world digest, active arc context, player history digest, tone config.
3. **Normalize**: deterministic repair of common defects (unresolved entity references matched to existing entities or flagged; missing fields defaulted).
4. **Validate & admit** (the gate): schema compliance; referential integrity (all entities exist or are in the spawn manifest); **solvability check** — simulated evaluation that every objective's predicate is reachable from current world state; stakes/reward bounds; tone/content policy. Implemented as an evaluate/optimize workflow: validator rejects with reasons → designer revises → bounded retries → admit or discard (logged).
5. **Instantiate**: spawn manifest applied (items placed, NPCs given knowledge, clues distributed), quest offered through the giver's normal behavior — the player encounters it as conversation, rumor, or event, not a "!" icon.

### 8.3 Backstory pairing

Every generated quest binds to generated **backstory**: the quest_designer receives (and may extend) the giver's backstory and local lore, and its output includes backstory deltas (admitted into the lore graph, §10) so quests deepen the world instead of floating on it. The widow's request to clear rats references her late husband's mine; the mine's records name a foreman; the foreman is findable — three sidequests later the player realizes they've been excavating one buried story. **Quest chains are lore-graph traversals.**

### 8.4 Quests from NPC agendas (the differentiator)

Bottom-up flow: NPC Deliberate tier hits a plan step it cannot achieve alone → emits `quest_propose` with the *real* agenda linkage → Director admission checks dramatic fit, load (active quest count), and redundancy → admitted proposals go through pipeline steps 2–5. Because the motivation is real, quest outcomes genuinely change the NPC: complete the blacksmith's ore run and her forge output actually rises, her goal progresses, her gratitude is a relationship edge with memory behind it. Refuse, and she asks someone else — the world does not wait.

### 8.5 Dynamic evolution

- Quest state machine: `offered → active → (branch states) → resolved(success|failure|abandoned|transformed)`.
- **Transformation**: the Director may rewrite the remaining objectiveGraph mid-quest in response to player action or world events (the fugitive you were hunting was assassinated; who hired the assassin?). Transformations go through the same validate/admit gate.
- All resolutions write consequences: relationship changes, faction standing, economic effects, chronicle entries, potential follow-on hooks.

## 9. Campaign System

- A **campaign** = an arc skeleton: `{ theme, dramatic shape (act structure with tension targets), antagonist force (faction/entity with its own Warm-simulated agenda), arc storylets, entry hooks, possible climaxes (plural), epilogue hooks }`.
- The **Campaign Weaver** builds arcs from what exists: it mines the world DB and chronicle for tensions (faction rivalries, unresolved quest fallout, player reputation) and proposes an arc that *recruits* existing NPCs and lore rather than inventing a parallel cast. Player-history conditioning makes each campaign personal.
- Adventures (quest clusters/dungeon expeditions) are beads on the arc string; the Weaver plans one act ahead in detail, later acts as shape only (late binding).
- Arc progression is event-driven: predicates over world state advance acts; the Director paces reveals via storylets.
- Campaign completion writes a **saga record** — the top-level input to legend generation (§10.3).

## 10. Worldgen, Lore, and Legends

### 10.1 World generation (offline pipeline, staged like the quest pipeline)

1. **Physical**: region map (biomes, settlements, roads, dungeons) — deterministic PCG with seeds; LLM names and flavors.
2. **Mythic history** (Dwarf Fortress inspiration): `lore_master` simulates compressed history in eras — founding myths, wars, migrations, calamities, hero-figures — emitting a **lore graph**: entities (historical figures, artifacts, places, events) + typed relations + era timestamps. Schema-validated like everything else.
3. **Present-day cast**: factions, settlements' NPC rosters generated *from* the lore graph (the innkeeper descends from a war hero; the ruined tower belonged to a named wizard whose apprentice's ghost holds a grudge). Persona sheets, relationships, and agendas seeded with lore hooks.
4. **Seeding**: initial storylet bindings, ambient quest hooks, secrets distribution (who knows what — the knowledge boundary map).

### 10.2 The Chronicle

The in-fiction record of the *current* era: a structured, append-only narrative event store (distinct from the raw event log — the chronicle is curated). The Director appends chronicle entries for narratively significant events with tags (participants, locations, arcs). Sources: quest resolutions, deaths of named NPCs, faction shifts, player deeds above an importance threshold. The chronicle powers: the player's journal, NPC gossip seeds, campaign weaving, and legend generation.

### 10.3 Legends and multi-playthrough persistence

- Worlds persist; characters are mortal. At playthrough end (death, retirement, campaign epilogue), a **legend-forging pass** runs: `lore_master` compresses the playthrough's chronicle into legend entries — with *era-appropriate distortion* (deeds inflate, motives get mythologized, names shift) controlled by an accuracy-decay parameter. Legends enter the lore graph.
- Next playthrough in the same world: time advances (configurable gap), the world simulates the interregnum in coarse strokes (successions, ruin, renewal), and the new character finds statues, songs, rival claimants to their predecessor's legacy — and NPCs who remember the previous character personally if the gap is short.
- The previous character can optionally be instantiated as a legend-NPC (ghost, portrait, tomb guardian) with a persona distilled from their actual play history.

## 11. LLM Budget, Latency, and Model Tiering

Cost is a design constraint, not an afterthought (flagged as the neglected dimension in the eval-survey literature).

- **Model tiers** (configured per agent in SkillShop registration):
  - Frontier model: Director decisions, Campaign Weaver, quest design, legend forging (low frequency, high leverage).
  - Mid model: focal NPC dialogue (quality matters, streamed).
  - Small/cheap model: importance scoring, trigger evaluation, gossip batching, cold-NPC life summaries, embeddings. (Future: fine-tuned small model for NPC chatter, per the PLAYER:NPC distillation pattern.)
- **Token governor**: per-world budgets (per real-hour and per game-day) enforced by the NPC scheduler and Director; when budget tightens, Deliberate jobs stretch their intervals and cold-tier batch sizes grow. Hard caps fail visible (dev HUD warning), never silent.
- **Caching**: persona prompt prefixes stable per NPC (prompt-cache friendly); world digests memoized per locale per tick; embeddings cached permanently.
- **Batching**: cold-tier updates batched many-NPCs-per-call with structured output.
- **Full telemetry**: every LLM call tagged `(world, agent, npc, tier, purpose)` with tokens/latency/cost recorded — the eval framework and the governor both read this.

## 12. Evaluation Framework

Built alongside the game, per literature §2. Lives in `server/eval/`.

### 12.1 Tiers

| Tier | What | How |
|---|---|---|
| **Micro: NPC believability** | Persona consistency, knowledge-boundary violations (hallucinated knowledge), personality back-testing, memory-grounding accuracy | Scripted probe conversations run by a **simulated player agent**; LLM judge scores against the ground-truth persona sheet and memory stream (CharacterEval dimensions, MMRole-style baseline comparison) |
| **Meso: quest & scene quality** | Solvability (predicate reachability), coherence with lore, objective clarity, branch fairness, reward calibration; scene pacing | Deterministic predicate checks (GameWorld-style, zero-judge) + LLM-judged narrative rubric on quest artifacts and scene transcripts |
| **Macro: world liveliness** | Event density, relationship-graph churn, information diffusion rate, economic/role differentiation, arc completion rates, contradiction counts | Unattended long-run simulations ("aquarium runs"): N game-days with no player or with a simulated player; metrics computed from event log + chronicle |

### 12.2 Harness

- **Golden scenarios**: fixed world seeds + scripted player trajectories replayed against every significant change; diffs in metrics gate merges.
- **Simulated players**: an LLM player agent with a play-style persona (murder-hobo, diplomat, completionist) drives automated soak tests — also the tool for adversarial probing (persona-breaking attempts, exploit-hunting).
- **Cost/latency dashboards** from §11 telemetry; regression thresholds on cost-per-scene and p95 dialogue first-token latency.
- **Human-in-the-loop**: lightweight in-client rating affordances (dev builds): thumbs on dialogue lines, post-quest 3-question survey. Correlate with automated judges to calibrate them.

## 13. Data Model Summary (per-world DB)

Core tables (all zod-schema'd in `shared/`, mirrored in SQLite):

- `entities`, `components` (typed JSON per component kind)
- `events` (append-only), `actions` (submitted/validated/applied audit)
- `npc_state` (agenda, tier, scheduler bookkeeping), `memories` (+ embedding index), `relationships`, `promises`
- `quests`, `objectives`, `quest_events`
- `arcs`, `storylets`, `storylet_firings`
- `lore_nodes`, `lore_edges` (the lore graph), `chronicle`, `legends`, `sagas`
- `playthroughs`, `player_history_digest`
- `llm_calls` (telemetry), `eval_runs`, `eval_metrics`

SkillShop's own DB stores only agents/tools/sessions/chats; no game state lives there.

## 14. Security & Content Controls

- **Prompt-injection surface**: player free-text reaches NPC prompts. Mitigations: player input is always delimited and role-tagged in prompts; tools enforce the knowledge boundary and action validation regardless of what the model "believes"; Director consistency checks catch persona hijacks. Red-team probes are part of the eval suite (§12.2).
- **Tone configuration**: per-world content policy (violence/horror/romance dials) injected into every generation prompt *and* enforced by the admission validators (belt and suspenders).
- **Tool RBAC**: llmrpg tool endpoints check `X-SkillShop-*` headers; NPC tools are scoped to the acting NPC (an NPC cannot read another's memory stream); Director tools require the director agent context.

## 15. Technology Stack

- TypeScript end-to-end. Client: React + Vite + Tailwind (mirrors SkillShop conventions). Server: Express, better-sqlite3, zod, drizzle-orm (matching SkillShop's stack for shared idioms).
- SkillShop submodule pinned; service mode env per SKILLSHOP_SERVICE.md (`SKILLSHOP_SERVICE_MODE=true`, `VPS_ENABLED=false`, `MCP_ENABLED=false`, `ALLOWED_ORIGINS` for :4001/:4002).
- Dev orchestration: extend `scripts/ensure-dev.sh` / `scripts/kill-all-processes.sh` conventions to manage all three processes; SkillShop DB initialized via its `db:init`/`db:load`.
- Embeddings: provider via SkillShop; vector search via SQLite (sqlite-vec) — decision task in Phase 2 (alternatives: in-process HNSW).

## 16. Implementation Roadmap

Phases are cumulative; each ends with a playable/demonstrable milestone and its slice of the eval harness.

### Phase 0 — Foundations (skeleton walk)
Repo scaffolding (client/server/shared/eal); SkillShop submodule boots in service mode with DB init; llmrpg server registers one hello-world agent + one HTTP tool and round-trips an execution with SSE into a stub client page; dev scripts (ensure-dev, kill-all) manage all processes; CI with typecheck (`npm run check`) + unit tests.
**Milestone**: chat with a placeholder NPC in the browser through the full three-process pipeline.

### Phase 1 — Engine core & roguelike client
EAL core interfaces; roguelike-web adapter (glyph renderer, FOV, input); world DB + entity/component model; Action system + rules engine v1 (move, take, give, use, attack-lite, talk); event log; single handcrafted test locale ("Milltown"); turn ticker; client panels (map, log, dialogue modal, journal stub).
**Milestone**: walk around Milltown, pick things up, open a dialogue window with a static NPC.

### Phase 2 — NPC cognition v1
Persona sheets + agenda model; memory stream with scored retrieval (embeddings, cache); perception filter; `npc_actor` agent + core NPC tools (`world_query`, `memory_search`, `npc_act`, `npc_say`); Reflex tier (routines/schedules); Converse tier with streaming dialogue; reflection via loop workflow; NPC scheduler v1 (Focal/Warm only); ~10 handcrafted Milltown NPCs with interlocking relationships.
**Milestone**: NPCs remember prior conversations, gossip about the player, and visibly pursue daily agendas. Micro-eval suite v1 (persona probes, knowledge-boundary checks) running in CI.

### Phase 3 — Quests v1 (infinite sidequests)
Quest schema + objective predicates + state machine; generation pipeline (hook→draft→normalize→validate→admit→instantiate) with the evaluate/optimize revision loop; solvability checker; bottom-up `quest_propose` from NPC agendas; quest journal UI; consequences writing back to relationships/agendas.
**Milestone**: play an endless stream of coherent, solvable, agenda-grounded sidequests in Milltown. Meso-eval suite v1.

### Phase 4 — Director & storylets
Plot-state model + tension tracking; storylet schema + authored starter library; trigger evaluation tick; Director agent + tools (fire_storylet, inject_event, admit_quest, spotlight, chronicle); scene direction briefs for focal NPCs; consistency guardian v1; chronicle + player journal integration.
**Milestone**: sessions have pacing — twists land at the right time, quiet stretches get stirred, quest offers weave into an emerging plot.

### Phase 5 — Worldgen, lore, and scale
Physical worldgen (regions, several settlements, dungeons); mythic-history pipeline → lore graph; cast generation from lore; Cold tier + statistical simulation + wake-up rendering; token governor + full telemetry; model tiering config; macro-eval "aquarium runs".
**Milestone**: a generated world of 100+ NPCs across multiple locales runs within budget; travel somewhere new and find NPCs whose lives moved on without you.

### Phase 6 — Campaigns
Campaign Weaver (arc mining from world/chronicle/player history); arc skeletons with late binding; antagonist-force simulation (pinned Warm faction agenda); act-progression predicates; arc storylet generation; climax/epilogue handling; saga records.
**Milestone**: complete a multi-adventure campaign whose antagonist was plotting all along and whose finale reflects accumulated player choices.

### Phase 7 — Legends & multi-playthrough worlds
Legend-forging pass with mythologization decay; interregnum simulation; new-playthrough bootstrapping into a persisted world; memorialization content (statues, songs, tomb-NPCs); legacy hooks into campaign weaving.
**Milestone**: die gloriously, start a new character fifty years later, and hear a distorted ballad about yourself in a tavern.

### Phase 8 — Hardening & second-adapter proof
Adversarial/red-team eval expansion; cost optimization round (distilled small model for NPC chatter — go/no-go on fine-tuning); performance (scheduler under 500+ NPCs); a second EAL adapter spike (minimal tile-sprite or 3D-lite renderer) to prove the abstraction before any real 3D investment.
**Milestone**: stable long-session play; EAL validated by a working second adapter.

## 17. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| LLM cost blows up with NPC count | Cognition LOD + token governor + model tiering are Phase-2/5 core, not add-ons; macro evals track cost-per-game-day |
| Dialogue latency breaks immersion | Streaming everywhere; Reflex tier handles instant reactions; Converse prompts kept prompt-cache-stable |
| Narrative drift / world contradictions | Single source of truth (world DB), validated tools only, admission gates, Director consistency guardian, chronicle audits in eval |
| Generated quests are samey | Diversity metrics in meso-eval; hook-source mixing (bottom-up/top-down/ambient); storylet library breadth; lore-graph traversal produces long chains |
| Director railroads the player | Late binding, plot-reflection replanning, agency metrics in eval, failure-is-content policy |
| SkillShop service coupling too tight | All SkillShop access behind a thin `server/agents/` gateway module; agents/tools registered from data, so a future alternative runtime is a gateway swap |
| Prompt injection via player chat | Delimited inputs, tool-side validation as the real security boundary, red-team suite |

## 18. Open Questions (tracked as decision tasks)

1. Vector search implementation (sqlite-vec vs. in-process HNSW) — Phase 2.
2. rot-js vs. bespoke FOV/pathfinding — Phase 1.
3. Real-time (fixed-step) vs. strictly turn-based background ticks for the focal locale — prototype both in Phase 2; affects how conversations and world time interleave.
4. Multiplayer-safe world-state partitioning — keep the Action/Event model compatible; no commitment before Phase 8.
5. Fine-tuned NPC chatter model: build vs. wait for better small models — data collection (transcripts + judge scores) starts Phase 3 regardless, decision Phase 8.
