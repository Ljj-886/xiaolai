Component({
  properties: {
    icon: String,
    title: String,
    desc: String,
    actionText: String,
    retryText: String
  },
  methods: {
    onAction() { this.triggerEvent('action'); },
    onRetry() { this.triggerEvent('retry'); }
  }
});
