# Architecture rule

Domain modules must not import from the CLI layer. Shared domain behavior must
live in a domain-owned module so that the CLI remains an adapter.
