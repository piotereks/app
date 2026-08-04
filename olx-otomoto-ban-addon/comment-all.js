window.commentAll = function() {
    const text = prompt("Comment:", "");
    if (text === null) return;
    window.dispatchEvent(new CustomEvent("olxBanSetCommentAll", { detail: { comment: text } }));
};
