# AGENTS.md

## What This Project Is

This project generates specialized coding-agent instructions for one narrow subject inside one specific repository.

The goal is to discover whether something unique about that subject allows a coding model to use a faster or better workflow than its normal general-purpose approach.

The instructions are only used for their exact project and subject.

## Product Scope

Long term, the system may support:

* Multiple coding models
* Cost-efficient, balanced, and performance modes
* Model-specific solvers
* Context and caching recommendations
* Automated instruction testing
* Evolutionary instruction generation

The MVP focuses on Claude Sonnet in cost-efficient mode.

Do not permanently couple shared project logic to Sonnet or cost optimization.

## Core Principle

Do not build a generic prompt generator.

A useful solver should change how the model approaches the work by providing things such as:

* A project-specific problem representation
* A better reasoning order
* A niche shortcut or workaround
* Decisions that can be skipped
* A focused verification method
* Escalation and stopping conditions

Generic advice such as "follow best practices" or "write clean code" is not valuable here.

## Subject Exclusivity

Each solver belongs to:

* One project
* One subject
* One target model
* One optimization mode
* One version

A solver should not be generalized just to make it useful elsewhere.

It is acceptable for a shortcut to be unsuitable outside its exact subject.

## Model and Mode Separation

Keep these concepts separate:

* Repository and subject evidence
* Workflow hypothesis
* Target model
* Optimization mode
* Final generated solver

A project-specific insight may apply to several models, while the best wording and behavior may differ by model.

## Evaluation

Do not call instructions optimized because they sound convincing.

Compare them against a baseline.

Track relevant measurements such as:

* Correctness
* Monetary cost
* Input and output tokens
* Tool calls
* Files inspected
* Retries
* Rewrites
* Human corrections

Cost-efficient mode should reduce cost without dropping below the required correctness level.

Balanced mode should trade off cost, quality, speed, and maintainability.

Performance mode should prioritize the strongest result even when it costs more.

## Context and Caching

Additional input can be worthwhile when it prevents more expensive output, failed work, or repeated exploration.

However, cheap or cached context can still distract the model.

Prefer:

* High-signal summaries
* Stable subject knowledge
* Relevant excerpts
* Just-in-time retrieval

Avoid preloading large files only because they can be cached.

Keep host-level caching recommendations separate from the instructions given to the coding model.

## Evidence

Project-specific claims should be grounded in:

* Current code
* Tests
* Runtime behavior
* Repeated implementations
* Agent trajectories
* User-confirmed outcomes

Clearly distinguish confirmed findings from hypotheses.

"No reliable shortcut found" is a valid result.

## Future Evolutionary Optimizer

The system may later use another model to generate, mutate, combine, test, and rank instruction variants.

Any evolutionary system must optimize against measured task results, not model opinions alone.

It should preserve:

* Benchmark integrity
* Held-out tasks
* Solver versioning
* Reproducible comparisons
* Correctness thresholds

Do not build this before basic solver generation and evaluation work reliably.

## Development Priorities

Prioritize:

1. Clear project, subject, model, mode, solver, task, and run data
2. Baseline-versus-solver comparison
3. Configurable cost measurement
4. Subject-specific solver generation
5. Evidence and result tracking
6. Simple solver export

Avoid unnecessary platform complexity before the core idea is proven.

## Decision Rule

When choosing between a polished feature and an experiment that tests the core idea, build the experiment.

When choosing between a clever instruction and a measurable instruction, choose the measurable one.

When evidence is weak, preserve uncertainty.
