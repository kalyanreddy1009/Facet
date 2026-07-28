"""The control plane: user lifecycle, provisioning, and the admin portal.

Separate from the per-user app on purpose. In the host deployment (PLAN.md)
this runs natively on the host — it is the only thing that touches the agy
binary and the Docker socket — while each user's Facet runs in its own
container that needs neither.

It lives in the same repo and the same venv because it shares the schema and
the paths module with the app. It is a different entrypoint, not a different
project.
"""
