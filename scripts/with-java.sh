#!/usr/bin/env sh
# firebase-tools 15 needs `java` >= 21 on PATH (it ignores JAVA_HOME). On macOS, prefer the
# newest installed JDK that qualifies so the default `java` can stay older for other work.
if [ -x /usr/libexec/java_home ]; then
  JH=$(/usr/libexec/java_home -v 21+ 2>/dev/null)
  if [ -n "$JH" ]; then
    export JAVA_HOME="$JH"
    export PATH="$JH/bin:$PATH"
  fi
fi
exec "$@"
