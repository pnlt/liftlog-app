# MYØS

**Myo (muscle) + OS — hệ điều hành dành cho cơ bắp.**

MYØS is a minimalist training system. Its identity is simple, premium, and distinct:
clear typography, a restrained palette, and practical language about training.

- Display name and wordmark: **MYØS**, using the letter `Ø`, never a zero.
- Vietnamese tagline: **Hệ điều hành dành cho cơ bắp.**
- English tagline: **The operating system for muscle.**
- Technical slug and package names use ASCII: `myos`, `@myos/mobile`,
  `@myos/domain`, `@myos/contracts`, and `@myos/plan-agent`.
- The backend management command is `myos`; `liftlog` remains a compatibility alias.

## Existing installations and data

The rebrand preserves the existing PostgreSQL database name (`liftlog`), SQLite
filename (`liftlog.db`), native application identifiers (`com.team3ae.liftlog`),
and OAuth URL scheme (`liftlog`). Changing those would require separate storage,
installation, and identity-provider migrations. The local checkout directory,
container names, immutable catalog versions, and internal dev-server ownership
marker can retain their original technical names.

Historical architecture decisions and review evidence retain their original names.
Current documentation and commands use MYØS and the `@myos` workspace scope.

The app name on a native home screen changes with the next native build. Branding
inside externally managed Clerk/Google consent pages is configured in those services;
this repository change does not rename the external identity-provider application.
