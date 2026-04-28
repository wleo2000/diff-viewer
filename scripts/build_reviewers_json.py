"""One-off helper: parse pasted TSV into data/reviewers.json (task_id -> contributor, date)."""

from __future__ import annotations

import json
from pathlib import Path

RAW = r"""
06473005-29a0-45b5-b35f-2f1b9d245aa8	04/17	John Wang
0fa85acc-0ef3-4151-906d-915b92935355	04/17	Nate Cohen
112eeb54-4cf5-4fb3-b3b3-940bfb57c4e2	04/17	Elliot Saye
14ac18f5-d0ca-4038-9337-6933d802cd6e	04/17	John Wang
14aea5e9-c8bc-4ea1-b394-ec53ae693dcc	04/17	Elliot Saye
16133ae8-d247-4c6b-8e4e-6a335500805a	04/17	John Wang
17e93566-322a-4698-9458-6ccb938903ce	04/17	Elliot Saye
24d476ae-b333-4ccf-89f2-44720dad5031	04/17	Elliot Saye
2ae402d9-2146-4425-ab26-24e8fb475348	04/17	Elliot Saye
2da8d19e-ed98-4b81-b1fc-aec33b5fc492	04/17	Jay Namdhari
33b198aa-7a72-4aa6-b4e7-97b57f47ebfd	04/17	Elliot Saye
354c38bd-9b17-4de7-ad50-b159b2def221	04/17	John Wang
3ff3aabd-3236-49bb-b622-f7e49f1cab99	04/17	John Wang
43d0479d-e4f0-4f4a-bc34-300dac536cb1	04/17	Elliot Saye
481cd80c-28fc-41ab-a687-6181c06729b2	04/17	Jay Namdhari
52382437-ac82-44fe-95a9-b9fe219b1a8e	04/17	John Wang
5dc6bfe1-4d52-4f37-be6e-b43fed3fdf5b	04/17	Spencer Howe
5e8d104c-7199-478d-a3d0-abcdb4d82ef3	04/17	John Wang
63ef44ae-a6fc-4335-b303-2303535ade43	04/17	John Wang
67890151-5c1a-458d-b486-6f78ffc5ac00	04/17	Andrew Kuznetsov
70134887-ac90-40bb-ab19-70b5af9970ab	04/17	Spencer Howe
7750780f-206b-43f2-a1b6-6adea02a3f0b	04/17	Spencer Howe
7b64916b-2538-45dd-8de5-271e95329490	04/17	Spencer Howe
81667632-e967-45f6-b06b-696090fcc8ed	04/17	Andrew Kuznetsov
8a2d03eb-2e13-4d6f-ad2c-87c9a9cfbe73	04/17	Elliot Saye
99e9c932-ffec-4eab-8943-94fa55505c98	04/17	Elliot Saye
a23fe17e-6985-4dfb-bf43-53fddef329a8	04/17	John Wang
a2dcb2eb-2827-4a06-84a2-6b369705cadf	04/17	John Wang
b2b8028b-7cb1-4618-84fe-e72a80fa0dd3	04/17	Elliot Saye
b661b687-68f9-4b20-b8ea-1f51bd21ce76	04/17	John Wang
b6ff3d68-fd93-4b27-b359-e9133b897b5e	04/17	Spencer Howe
b874f8cf-0870-4b66-9fca-f333b86d79ca	04/17	Elliot Saye
ba557cb0-6dfe-4c94-9f6a-e3486f40b2e2	04/17	Elliot Saye
babdf30b-a604-453d-8120-dc3ff8e2c042	04/17	Jay Namdhari
c6729264-c5b0-41ca-aaf4-bdc0810ef473	04/17	Spencer Howe
c915ae40-accc-41c9-8353-5864c102b5e1	04/17	Alex Moon
c9627631-680c-4fbc-8b90-e00a32277480	04/17	Elliot Saye
d23452c3-6acd-4c0f-9e1a-e5786368732a	04/17	Alex Moon
e2f5fede-3901-4d54-b476-6eb28d05372a	04/17	Nate Cohen
e3c42eb8-32f4-43d3-b205-db99070344b2	04/17	Alex Moon
e7f60f77-b4b3-4c83-91cd-95b622ad46df	04/17	Alex Moon
e7ff8afb-2360-41d6-9dab-1ce6da878f97	04/17	Elliot Saye
ed94f8cb-7e44-44e8-b598-22c542d10a87	04/17	John Wang
f36a98f3-3d0c-4d52-8cb1-b0d927bf96fb	04/17	Spencer Howe
"""


def main() -> None:
    out: dict[str, dict[str, str]] = {}
    for line in RAW.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 2)
        if len(parts) < 3:
            raise SystemExit(f"Bad line: {line!r}")
        task_id, review_date, contributor = parts
        out[task_id] = {"review_date": review_date, "contributor": contributor}

    dest = Path(__file__).resolve().parent.parent / "data" / "reviewers.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} rows to {dest}")


if __name__ == "__main__":
    main()
