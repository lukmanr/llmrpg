# llmrpg

An exploration of how to build an immersive RPG world powered by AI agents.

llmrpg is an LLM-powered RPG designed around **societies of autonomous NPC agents**. The goal is to replicate the D&D experience brought to life by an expert dungeon master — one who combines great storytelling with creative tactical and side-quest twists — in an open game world where NPCs live as autonomous beings with their own agendas, motivations, goals, and aspirations.

The product promise: **form attachments, change people's lives, and return to evidence that they remember.** Persistent, legible, personal consequence is the differentiator — not content volume.

## Vision

The NPC agents are the focus of this project. We are building a **generic agentic framework to power societies of NPCs**, so that they act as improvisational players on an open-world stage — reacting and evolving with the storyline. NPCs pursue their own in-world goals; a Director system curates which of their collisions become visible drama, so that the system as a whole produces memorable stories and experiences for the human player. Players will ultimately interact with these agents in open-world 3D-modeled environments; the first release targets a browser-based **2D roguelike UI**.

### Setting

**Tolkienesque fantasy** with **anything goes** in terms of plot elements and characters — one could find that the thieves' guild leader is a zombie controlled by an alien brain in a vat in low earth orbit.

### Signature experiences

- **Infinite sidequests** — procedurally generated backstories paired with "choose your own adventure" dynamics; NPC characters react and evolve with the storyline rather than dispensing static quest text.
- **Campaigns** — individual adventures strung together into larger story arcs with foreshadowing, escalation, and payoff.
- **A living, remembering world** — inspired by Dwarf Fortress, we build a world for the adventurer that includes lore, myth, and legends. Worlds persist across multiple playthroughs, where the player's previous lives may be memorialized in new legends.

The project is also an exploration of **quest design and storytelling in a game world populated with multiple long-running agentic NPCs**.

## Architecture

Two foundational decisions:

1. **Engine independence.** The game supports 2D or 3D graphics and is designed to use any engine. We develop our own internal **Engine Abstraction Layer (EAL)** over the game engine, then implement an adapter for each targeted engine or API. Game logic, NPC cognition, and narrative systems depend only on the abstraction; the first adapter is a browser roguelike renderer.

2. **SkillShop in service mode.** The agentic framework uses [SkillShop](skill-shop/README.md) — checked out as a git submodule at `skill-shop/` — running in service mode. SkillShop provides LLM orchestration, agent registration and execution, streaming, sessions, and workflow agents (sequential, parallel, loop, router, evaluate/optimize, scheduled). The llmrpg server registers its agents and tools with SkillShop at startup and implements tool execution as HTTP callbacks; all world state stays authoritative in the llmrpg server. See [SKILLSHOP_SERVICE.md](skill-shop/docs/technical/SKILLSHOP_SERVICE.md).

```
Game Client (browser :4001)
    ├── game domain APIs  → llmrpg Server (:4002) — world simulation, rules engine,
    │                                               quests, narrative, NPC scheduler
    └── agent/chat APIs   → SkillShop (:5173, service mode) — LLM orchestration,
                                        agent execution, streaming ⇄ HTTP tool
                                        callbacks to the llmrpg server
```

The load-bearing design rule: **LLMs propose; the engine disposes.** Every world mutation flows through a validated action in the llmrpg rules engine — agents affect the world only through registered, validated tools.

### Core subsystems

- **NPC cognitive architecture** — persona sheets, agendas (drives → goals → plans → intents), memory and beliefs with provenance (who told whom, distorted how), hybrid retrieval with reflection, relationship models, and split-speed cognition (reflex / conversational / deliberative tiers) with level-of-detail simulation so hundreds of NPCs stay affordable.
- **Player experience architecture** — the loop that makes the simulation playable: consequence receipts ("Because you…"), promises and appointments as tracked gameplay objects, rumor provenance as investigative play, semantic dialogue acts over free text, visible NPC activity, player-authored vows, and a journal that is a core gameplay surface.
- **The Director** — an AI dungeon master: a deterministic drama-management core (tension cycle, thread caps, compiled storylet triggers with typed role casting, progress clocks, story sifters) with LLM elaboration and judgment layered on top — never puppeteering NPC minds or railroading the player.
- **Quest system** — schema-validated quest artifacts with witness-plan solvability certificates and success-with-cost outcomes; quest hooks sourced bottom-up from real NPC agendas and top-down from campaign arcs.
- **Worldgen, lore, and legends** — generated mythic history as a lore graph, a curated chronicle of the current era, and legend-forging that mythologizes each playthrough into the persistent world.
- **Evaluation framework** — NPC believability, quest quality, world liveliness, and player-experience outcomes (attachment, recall, perceived consequence) measured continuously with simulated players, state-verifiable predicates, and architectural ablation baselines.

## Documentation

- [Design Document](docs/design/DESIGN.md) — full architecture, subsystems, data model, and the phased implementation roadmap.
- [NPC Agent Literature Review](docs/research/NPC_AGENT_LITERATURE.md) — survey of published work on NPC agent cognitive architectures, evaluation frameworks and benchmarks, quest design with agentic NPCs, storytelling / drama management, and pre-LLM game-design precedents, with design implications for llmrpg.
- [Design Review](tasks/LLMRPG_DESIGN_REVIEW.md) — external review of the design; its recommendations are incorporated in the current design revision.
- [SkillShop README](skill-shop/README.md) and [technical docs](skill-shop/docs/technical/) — the agent platform llmrpg builds on.

## Status

**Phase 2 (Milltown vertical slice) implemented.** On top of the Phase 0 skeleton and Phase 1 engine: a nine-persona Milltown cast with interlocking relationships, secrets, and schedules; NPC cognition (memory streams with hybrid retrieval, beliefs with provenance and gossip distortion, reflection via durable background jobs); dialogue through a server-side orchestrator (one generic `npc_actor` agent, persona/memories/scene injected per turn) with semantic acts, patience/rapport conversation discipline, and NPC tools (`share_claim`, `make_promise`, `update_relationship`, `memory_search`); the player-experience loop (consequence receipts, tracked promises, the four-tab journal, character creation with vows); and the micro-eval suite with a global-actor baseline. See [DEVELOPMENT.md](docs/technical/DEVELOPMENT.md) to run it and [EVALUATION.md](docs/technical/EVALUATION.md) for the eval harness.

Next per the [roadmap](docs/design/DESIGN.md): the Milltown acceptance test (§7.9) as the gate, then the minimal deterministic Director with the first agenda-grounded quests, the LLM Director and chronicle, worldgen and scale, campaigns, and multi-playthrough legends.
