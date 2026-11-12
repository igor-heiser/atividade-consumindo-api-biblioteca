async function buscarLivro() {
    try {
        let buscaLivro = await fetch("https://openlibrary.org/search.json?q=harry+potter&limit=10");
        let buscaLivroConvertido = await buscaLivro.json();
        if(buscaLivroConvertido.error) {
            throw new Error("ERRO: dados do livro não encontrado!");
        }
        console.log(buscaLivroConvertido);
        return buscaLivroConvertido;
    } catch (error) {
        throw new Error(error);
    }
}

buscarLivro();