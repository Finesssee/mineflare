# MCP
Understand how the Model Context Protocol works with Apps SDK.
What is MCP?
The Model Context Protocol (MCP) is an open specification for connecting large language model clients to external tools and resources. An MCP server exposes tools that a model can call during a conversation, and return results given specified parameters. Other resources (metadata) can be returned along with tool results, including the inline html that we can use in the Apps SDK to render an interface.

With Apps SDK, MCP is the backbone that keeps server, model, and UI in sync. By standardising the wire format, authentication, and metadata, it lets ChatGPT reason about your app the same way it reasons about built-in tools.

Protocol building blocks
A minimal MCP server for Apps SDK implements three capabilities:

List tools – your server advertises the tools it supports, including their JSON Schema input and output contracts and optional annotations.
Call tools – when a model selects a tool to use, it sends a call_tool request with the arguments corresponding to the user intent. Your server executes the action and returns structured content the model can parse.
Return components – in addition to structured content returned by the tool, each tool (in its metadata) can optionally point to an embedded resource that represents the interface to render in the ChatGPT client.
The protocol is transport agnostic, you can host the server over Server-Sent Events or Streamable HTTP. Apps SDK supports both options, but we recommend Streamable HTTP.

Why Apps SDK standardises on MCP
Working through MCP gives you several benefits out of the box:

Discovery integration – the model consumes your tool metadata and surface descriptions the same way it does for first-party connectors, enabling natural-language discovery and launcher ranking. See Discovery for details.
Conversation awareness – structured content and component state flow through the conversation. The model can inspect the JSON result, refer to IDs in follow-up turns, or render the component again later.
Multiclient support – MCP is self-describing, so your connector works across ChatGPT web and mobile without custom client code.
Extensible auth – the specification includes protected resource metadata, OAuth 2.1 flows, and dynamic client registration so you can control access without inventing a proprietary handshake.

# User Interaction
How users find, engage with, activate and manage apps that are available in ChatGPT.

Discovery
Discovery refers to the different ways a user or the model can find out about your app and the tools it provides: natural-language prompts, directory browsing, and proactive entry points. Apps SDK leans on your tool metadata and past usage to make intelligent choices. Good discovery hygiene means your app appears when it should and stays quiet when it should not.

Named mention
When a user mentions the name of your app at the beginning of a prompt, your app will be surfaced automatically in the response. The user must specify your app name at the beginning of their prompt. If they do not, your app can also appear as a suggestion through in-conversation discovery.

In-conversation discovery
When a user sends a prompt, the model evaluates:

Conversation context – the chat history, including previous tool results, memories, and explicit tool preferences
Conversation brand mentions and citations - whether your brand is explicitly requested in the query or is surfaced as a source/citation in search results.
Tool metadata – the names, descriptions, and parameter documentation you provide in your MCP server.
User linking state – whether the user already granted access to your app, or needs to connect it before the tool can run.
You influence in-conversation discovery by:

Writing action-oriented tool descriptions (“Use this when the user wants to view their kanban board”) rather than generic copy.
Writing clear component descriptions on the resource UI template metadata.
Regularly testing your golden prompt set in ChatGPT developer mode and logging precision/recall.
If the assistant selects your tool, it handles arguments, displays confirmation if needed, and renders the component inline. If no linked tool is an obvious match, the model will default to built-in capabilities, so keep evaluating and improving your metadata.

Directory
The directory will give users a browsable surface to find apps outside of a conversation. Your listing in this directory will include:

App name and icon
Short and long descriptions
Tags or categories (where supported)
Optional onboarding instructions or screenshots
Entry points
Once a user links your app, ChatGPT can surface it through several entry points. Understanding each surface helps you design flows that feel native and discoverable.

In-conversation entry
Linked tools are always on in the model’s context. When the user writes a prompt, the assistant decides whether to call your tool based on the conversation state and metadata you supplied. Best practices:

Keep tool descriptions action oriented so the model can disambiguate similar apps.
Return structured content that references stable IDs so follow-up prompts can mutate or summarise prior results.
Provide _meta hints so the client can streamline confirmation and rendering.
When a call succeeds, the component renders inline and inherits the current theme, composer, and confirmation settings.

Launcher
The launcher (available from the + button in the composer) is a high-intent entry point where users can explicitly choose an app. Your listing should include a succinct label and icon. Consider:

Deep linking – include starter prompts or entry arguments so the user lands on the most useful tool immediately.
Context awareness – the launcher ranks apps using the current conversation as a signal, so keep metadata aligned with the scenarios you support.

Define tools
Plan and define tools for your assistant.

Tool-first thinking
In Apps SDK, tools are the contract between your MCP server and the model. They describe what the connector can do, how to call it, and what data comes back. Good tool design makes discovery accurate, invocation reliable, and downstream UX predictable.

Use the checklist below to turn your use cases into well-scoped tools before you touch the SDK.

Draft the tool surface area
Start from the user journey defined in your use case research:

One job per tool – keep each tool focused on a single read or write action (“fetch_board”, “create_ticket”), rather than a kitchen-sink endpoint. This helps the model decide between alternatives.
Explicit inputs – define the shape of inputSchema now, including parameter names, data types, and enums. Document defaults and nullable fields so the model knows what is optional.
Predictable outputs – enumerate the structured fields you will return, including machine-readable identifiers that the model can reuse in follow-up calls.
If you need both read and write behavior, create separate tools so ChatGPT can respect confirmation flows for write actions.

Capture metadata for discovery
Discovery is driven almost entirely by metadata. For each tool, draft:

Name – action oriented and unique inside your connector (kanban.move_task).
Description – one or two sentences that start with “Use this when…” so the model knows exactly when to pick the tool.
Parameter annotations – describe each argument and call out safe ranges or enumerations. This context prevents malformed calls when the user prompt is ambiguous.
Global metadata – confirm you have app-level name, icon, and descriptions ready for the directory and launcher.
Later, plug these into your MCP server and iterate using the Optimize metadata workflow.

Model-side guardrails
Think through how the model should behave once a tool is linked:

Prelinked vs. link-required – if your app can work anonymously, mark tools as available without auth. Otherwise, make sure your connector enforces linking via the onboarding flow described in Authentication.
Read-only hints – set the readOnlyHint annotation for tools that cannot mutate state so ChatGPT can skip confirmation prompts when possible.
Result components – decide whether each tool should render a component, return JSON only, or both. Setting _meta["openai/outputTemplate"] on the tool descriptor advertises the HTML template to ChatGPT.
Golden prompt rehearsal
Before you implement, sanity-check your tool set against the prompt list you captured earlier:

For every direct prompt, confirm you have exactly one tool that clearly addresses the request.
For indirect prompts, ensure the tool descriptions give the model enough context to select your connector instead of a built-in alternative.
For negative prompts, verify your metadata will keep the tool hidden unless the user explicitly opts in (e.g., by naming your product).
Capture any gaps or ambiguities now and adjust the plan—changing metadata before launch is much cheaper than refactoring code later.

Handoff to implementation
When you are ready to implement, compile the following into a handoff document:

Tool name, description, input schema, and expected output schema.
Whether the tool should return a component, and if so which UI component should render it.
Auth requirements, rate limits, and error handling expectations.
Test prompts that should succeed (and ones that should fail).

Storage
Persisting state and data for Apps SDK.

Why storage matters
Apps SDK handles conversation state automatically, but most real-world apps also need durable storage. You might cache fetched data, keep track of user preferences, or persist artifacts created inside a component. Choosing the right storage model upfront keeps your connector fast, reliable, and compliant.

Bring your own backend
If you already run an API or need multi-user collaboration, integrate with your existing storage layer. In this model:

Authenticate the user via OAuth (see Authentication) so you can map ChatGPT identities to your internal accounts.
Use your backend’s APIs to fetch and mutate data. Keep latency low; users expect components to render in a few hundred milliseconds.
Return sufficient structured content so the model can understand the data even if the component fails to load.
When you roll your own storage, plan for:

Data residency and compliance – ensure you have agreements in place before transferring PII or regulated data.
Rate limits – protect your APIs against bursty traffic from model retries or multiple active components.
Versioning – include schema versions in stored objects so you can migrate them without breaking existing conversations.
Persisting component state
Regardless of where you store authoritative data, design a clear state contract:

Use window.openai.setWidgetState for ephemeral UI state (selected tab, collapsed sections). This state travels with the conversation and is ideal for restoring context after a follow-up prompt.
Persist durable artifacts in your backend or the managed storage layer. Include identifiers in both the structured content and the widgetState payload so you can correlate them later.
Handle merge conflicts gracefully: if another user updates the underlying data, refresh the component via a follow-up tool call and explain the change in the chat transcript.

Optimize Metadata
Improve discovery and behavior with rich metadata.

Why metadata matters
ChatGPT decides when to call your connector based on the metadata you provide. Well-crafted names, descriptions, and parameter docs increase recall on relevant prompts and reduce accidental activations. Treat metadata like product copy—it needs iteration, testing, and analytics.

Gather a golden prompt set
Before you tune metadata, assemble a labelled dataset:

Direct prompts – users explicitly name your product or data source.
Indirect prompts – users describe the outcome they want without naming your tool.
Negative prompts – cases where built-in tools or other connectors should handle the request.
Document the expected behaviour for each prompt (call your tool, do nothing, or use an alternative). You will reuse this set during regression testing.

Draft metadata that guides the model
For each tool:

Name – pair the domain with the action (calendar.create_event).
Description – start with “Use this when…” and call out disallowed cases (“Do not use for reminders”).
Parameter docs – describe each argument, include examples, and use enums for constrained values.
Read-only hint – annotate readOnlyHint: true on tools that never mutate state so ChatGPT can streamline confirmation.
At the app level supply a polished description, icon, and any starter prompts or sample conversations that highlight your best use cases.

Evaluate in developer mode
Link your connector in ChatGPT developer mode.
Run through the golden prompt set and record the outcome: which tool was selected, what arguments were passed, and whether the component rendered.
For each prompt, track precision (did the right tool run?) and recall (did the tool run when it should?).
If the model picks the wrong tool, revise the descriptions to emphasise the intended scenario or narrow the tool’s scope.

Iterate methodically
Change one metadata field at a time so you can attribute improvements.
Keep a log of revisions with timestamps and test results.
Share diffs with reviewers to catch ambiguous copy before you deploy it.
After each revision, repeat the evaluation. Aim for high precision on negative prompts before chasing marginal recall improvements.

