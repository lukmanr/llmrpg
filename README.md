# llmrpg

An exploration of how to build an immersive RPG world powered by AI agents.

llmrpg is an LLM-powered RPG designed around **societies of autonomous NPC agents**. The goal is to replicate the D&D experience brought to life by an expert dungeon master — one who combines great storytelling with creative tactical and side-quest twists — in an open game world where NPCs live as autonomous beings with their own agendas, motivations, goals, and aspirations.

## Vision

The NPC agents are the focus of this project. We are building a **generic agentic framework to power societies of NPCs**, so that they act as improvisational players on an open-world stage — reacting and evolving with the storyline, and motivated to create memorable stories and experiences for the human player. Players will ultimately interact with these agents in open-world 3D-modeled environments; the first release targets a browser-based **2D roguelike UI**.

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

- **NPC cognitive architecture** — persona sheets, agendas (drives → goals → plans → intents), a memory stream with scored retrieval and reflection, relationship models, and split-speed cognition (reflex / conversational / deliberative tiers) with level-of-detail simulation so hundreds of NPCs stay affordable.
- **The Director** — an AI dungeon master: a drama manager that owns pacing, tension, and story arcs via natural-language-triggered storylets, without puppeteering NPC minds or railroading the player.
- **Quest system** — schema-validated quest artifacts with solvability checking; quest hooks sourced bottom-up from real NPC agendas and top-down from campaign arcs.
- **Worldgen, lore, and legends** — generated mythic history as a lore graph, a curated chronicle of the current era, and legend-forging that mythologizes each playthrough into the persistent world.
- **Evaluation framework** — NPC believability, quest quality, and world liveliness are measured continuously with simulated players, persona-consistency suites, state-verifiable predicates, and society-level metrics.

## Documentation

- [Design Document](docs/design/DESIGN.md) — full architecture, subsystems, data model, and the phased implementation roadmap.
- [NPC Agent Literature Review](docs/research/NPC_AGENT_LITERATURE.md) — survey of published work on NPC agent cognitive architectures, evaluation frameworks and benchmarks, quest design with agentic NPCs, and storytelling / drama management, with design implications for llmrpg.
- [SkillShop README](skill-shop/README.md) and [technical docs](skill-shop/docs/technical/) — the agent platform llmrpg builds on.

## Status

Design phase. The [design document](docs/design/DESIGN.md) defines the implementation roadmap, beginning with the three-process skeleton (client, llmrpg server, SkillShop service), followed by the engine core and roguelike client, NPC cognition, quests, the Director, worldgen and scale, campaigns, and multi-playthrough legends.
