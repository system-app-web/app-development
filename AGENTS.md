# Deployment Policy

- Do not start a Vercel deployment, redeployment, promotion, or other publishing action unless the user explicitly asks to deploy in the current task.
- Continue to create Git commits automatically for completed code changes.
- Do not push to GitHub automatically. After each commit, instruct the user: `GitHub Desktopを開いて、右上の **Push origin** を1回押してください。`
