Commands: the build, run, curl and whoami commands you ran, plus the lockfile one-liner.
What broke: first, the build failed because package.json and src/ didn’t exist. Second, npm ci failed with no lockfile. Third, curl got an empty reply right after the container started.
Root cause: the first two were missing files. The third was the port forward accepting connections before Node was listening.
Fix: you created the app files, generated package-lock.json, and waited for the listening on 3000 log line. Add the image size from docker image ls.