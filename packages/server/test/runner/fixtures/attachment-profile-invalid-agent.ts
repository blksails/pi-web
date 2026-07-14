// Real-subprocess fixture (agent-attachment-profile spec, task 6.1): declares an
// `attachmentProfile` name that is NOT among the host's declared backend names,
// so runner assembly must throw InvalidAgentDefinitionError and the process
// must exit before entering RPC/readiness (exit-before-ready failure chain).
export default {
  systemPrompt: "attachment-profile-invalid-agent (real-subprocess fixture)",
  attachmentProfile: "ghost-unregistered-profile",
};
