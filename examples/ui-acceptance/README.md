# Independent UI acceptance template

[简体中文](README.zh-CN.md)

Copy this folder into a project. In a task, say “Use the independent UI acceptance template for this change.” The agent fills in the brackets from the task. Each task owns its preview and can be reviewed before merging.

```text
Make <change> available to try in this task's checkout.
Start from <screen and sample state>. Verify <action → visible result> and the relevant exit, recovery or error path.
Reuse the project's actual screen and test tools. For a design proposal, label the mock and state what it simulates.
Use task-owned data and a free port if a service is needed. Run checks in the background. Test native focus or system dialogs in an isolated environment.
Reply here with the tested revision or working copy, one preview link or artifact, what to try and what passed. Identify any remaining human judgment. For a failure, include the expected and actual result and the relevant evidence.
```

For a web mock, open [preview.html](preview.html) in a browser. It includes sample pages and checks for filtering, empty results and clearing the query. Edit the interaction and its checks together. For a native app, use its own screen and UI test. When the reviewer is on a different machine, deliver an accessible build or a portable artifact with the matching test result.
