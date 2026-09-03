/**
 * Streaming Artifact Parser
 * 
 * Progressively parses Gemini text output containing <boltArtifact>
 * and <boltAction> tags, extracting actions and streaming file contents
 * in real-time as chunks arrive.
 */

export class ArtifactParser {
  constructor(callbacks = {}) {
    this.callbacks = {
      onArtifactStart: callbacks.onArtifactStart || (() => {}),
      onActionStart: callbacks.onActionStart || (() => {}),
      onActionUpdate: callbacks.onActionUpdate || (() => {}),
      onActionComplete: callbacks.onActionComplete || (() => {}),
      onArtifactComplete: callbacks.onArtifactComplete || (() => {}),
      onExplanationChunk: callbacks.onExplanationChunk || (() => {})
    };

    this.buffer = '';
    this.currentIndex = 0;
    this.currentArtifact = null;
    this.currentAction = null;
    this.completedActions = [];
  }

  /**
   * Ingests a new text chunk from the LLM stream.
   * @param {string} chunk - Newly arrived text token(s)
   */
  write(chunk) {
    this.buffer += chunk;
    this._processBuffer();
  }

  _processBuffer() {
    while (this.currentIndex < this.buffer.length) {
      if (!this.currentArtifact) {
        // Look for <boltArtifact ...>
        const artifactMatch = this.buffer.slice(this.currentIndex).match(/<boltArtifact\s+id="([^"]+)"\s+title="([^"]+)">/);
        if (artifactMatch) {
          const matchIndex = this.currentIndex + artifactMatch.index;
          // Text before the artifact is considered explanation/chat
          const preText = this.buffer.slice(this.currentIndex, matchIndex);
          if (preText) {
            this.callbacks.onExplanationChunk(preText);
          }

          this.currentArtifact = {
            id: artifactMatch[1],
            title: artifactMatch[2]
          };
          this.callbacks.onArtifactStart(this.currentArtifact);
          this.currentIndex = matchIndex + artifactMatch[0].length;
        } else {
          // Check if buffer end might be a partial start tag
          const remaining = this.buffer.slice(this.currentIndex);
          const potentialTagIndex = remaining.lastIndexOf('<boltArtifact');
          if (potentialTagIndex !== -1) {
            const preText = remaining.slice(0, potentialTagIndex);
            if (preText) {
              this.callbacks.onExplanationChunk(preText);
              this.currentIndex += potentialTagIndex;
            }
            break; // wait for full opening tag
          } else {
            this.callbacks.onExplanationChunk(remaining);
            this.currentIndex = this.buffer.length;
          }
        }
      } else if (!this.currentAction) {
        // We are inside an artifact, look for next <boltAction ...> or </boltArtifact>
        const remaining = this.buffer.slice(this.currentIndex);
        const artifactEndIndex = remaining.indexOf('</boltArtifact>');
        const actionMatch = remaining.match(/<boltAction\s+type="(file|shell|start)"(?:\s+filePath="([^"]*)")?>/);

        if (actionMatch && (artifactEndIndex === -1 || actionMatch.index < artifactEndIndex)) {
          this.currentAction = {
            type: actionMatch[1],
            filePath: actionMatch[2] || null,
            content: ''
          };
          this.callbacks.onActionStart(this.currentAction);
          this.currentIndex += actionMatch.index + actionMatch[0].length;
        } else if (artifactEndIndex !== -1) {
          // Finished artifact
          this.callbacks.onArtifactComplete(this.currentArtifact);
          this.currentIndex += artifactEndIndex + '</boltArtifact>'.length;
          this.currentArtifact = null;
        } else {
          break; // wait for more tokens
        }
      } else {
        // We are inside an action, stream content until </boltAction>
        const remaining = this.buffer.slice(this.currentIndex);
        const actionEndIndex = remaining.indexOf('</boltAction>');

        if (actionEndIndex !== -1) {
          const finishedContent = remaining.slice(0, actionEndIndex);
          this.currentAction.content += finishedContent;
          this.callbacks.onActionUpdate(this.currentAction, finishedContent);
          this.callbacks.onActionComplete(this.currentAction);
          this.completedActions.push(this.currentAction);

          this.currentIndex += actionEndIndex + '</boltAction>'.length;
          this.currentAction = null;
        } else {
          // Stream whatever is safe before any potential partial closing tag
          const partialTagIndex = remaining.lastIndexOf('</');
          if (partialTagIndex !== -1) {
            const safeContent = remaining.slice(0, partialTagIndex);
            if (safeContent.length > 0) {
              this.currentAction.content += safeContent;
              this.callbacks.onActionUpdate(this.currentAction, safeContent);
              this.currentIndex += safeContent.length;
            }
            break;
          } else {
            this.currentAction.content += remaining;
            this.callbacks.onActionUpdate(this.currentAction, remaining);
            this.currentIndex = this.buffer.length;
          }
        }
      }
    }
  }

  /**
   * Finalizes the stream and flushes remaining explanation text.
   */
  end() {
    if (this.currentIndex < this.buffer.length && !this.currentArtifact) {
      this.callbacks.onExplanationChunk(this.buffer.slice(this.currentIndex));
      this.currentIndex = this.buffer.length;
    }
  }
}
